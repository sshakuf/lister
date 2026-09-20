import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { parseOutline, serializeOutline, folderFilePath, findBullet, walk, type Bullet, type OutlineFile } from '@lister/core';
import { applyHiveOperation, emptyHive, type HiveSnapshot, type HiveOperation, type SharedFile } from '@lister/core/hive';
import { JsonDatabase } from './persistence.js';
const token = () => randomBytes(32).toString('base64url');
const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const copy = <T>(v: T): T => structuredClone(v);
interface Mapping {
    path: string;
    raw: string;
    baseline: SharedFile;
    error?: string;
    written?: string;
    relocation?: {
        from: string;
        to: string;
        raw: string;
    };
    intent?: {
        before: string;
        after: string;
        file: SharedFile;
        target: string;
    };
}
interface Data {
    version: 1;
    deviceId: string;
    sessionToken: string;
    label: string;
    name: string;
    role: 'hub' | 'client' | null;
    hiveId: string;
    generation: string;
    cursor: number;
    checkpoint?: string;
    checkpoints?: Record<string,string>;
    snapshot: HiveSnapshot;
    confirmed: HiveSnapshot;
    outbox: HiveOperation[];
    receipts: Record<string, string>;
    mappings: Record<string, Mapping>;
    devices: Record<string, {
        label: string;
        tokenHash: string;
        revoked?: boolean;
    }>;
    history: {
        cursor: number;
        operation: HiveOperation;
        checkpoint?: string;
    }[];
    invitations: Record<string, {
        expires: number;
    }>;
    address?: string;
    credential?: string;
    acks: Record<string, {
        ownerId: string;
        hash: string;
    }>;
}
export interface HiveResponse {
    snapshot: HiveSnapshot;
    cursor: number;
    generation: string;
    hiveId: string;
    deviceId: string;
    acks: Data['acks'];
    checkpoint: string;
}
export class HiveError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export class HiveAgent {
    private db: JsonDatabase<Data>;
    private data: Data;
    private busy: Promise<void> | null = null;
    connected = false;
    error: string | null = null;
    private stopped = false;
    constructor(readonly dir: string) {
        this.db = new JsonDatabase(dir);
        this.data = this.db.read() ?? { version: 1, deviceId: randomUUID(), sessionToken: token(), label: '', name: '', role: null, hiveId: '', generation: randomUUID(), cursor: 0, snapshot: emptyHive(), confirmed: emptyHive(), outbox: [], receipts: {}, mappings: {}, devices: {}, invitations: {}, acks: {}, history: [] };
        this.data.history ??= [];
        this.data.checkpoints ??= {};
        if(this.data.checkpoint)this.data.checkpoints[this.data.cursor]=this.data.checkpoint;
        if (this.data.version !== 1)
            throw new HiveError('Unsupported hive storage version');
        this.save();
    }
    private save() { this.db.write(this.data); }
    exportData() { return { snapshot: copy(this.data.snapshot), outbox: copy(this.data.outbox), hiveId: this.data.hiveId }; }
    fileIdForPath(p: string) { if (!p)
        return undefined; return Object.entries(this.data.mappings).find(([, m]) => m.path === path.resolve(p))?.[0]; }
    get enabled() { return !!this.data.role; }
    get sessionToken() { return this.data.sessionToken; }
    get deviceId() { return this.data.deviceId; }
    get role() { return this.data.role; }
    status() { return { enabled: this.enabled, role: this.data.role, label: this.data.label, name: this.data.name, hiveId: this.data.hiveId, deviceId: this.deviceId, connected: this.data.role === 'hub' || this.connected, pending: this.data.outbox.length, error: this.error, fileStatus: Object.fromEntries(Object.entries(this.data.mappings).map(([id, m]) => [id, { path: m.path, error: m.error, written: m.written, pending: m.written !== hash(this.data.snapshot.files[id]) }])), devices: Object.entries(this.data.devices).map(([id, d]) => ({ id, label: d.label, revoked: !!d.revoked })), address: this.data.address }; }
    response(): HiveResponse { return copy({ snapshot: this.data.snapshot, cursor: this.data.cursor, generation: this.data.generation, hiveId: this.data.hiveId, deviceId: this.deviceId, acks: this.data.acks, checkpoint: this.data.checkpoint ?? hash(this.data.confirmed) }); }
    create(name: string, label: string, rootPath: string) {
        if (this.enabled)
            throw new HiveError('Already belongs to a hive');
        if (!name?.trim() || !label?.trim())
            throw new HiveError('Hive name and device label required');
        const before = copy(this.data);
        try {
            this.data.role = 'hub';
            this.data.name = name.trim();
            this.data.label = label.trim();
            this.data.hiveId = randomUUID();
            this.register(rootPath, true);
            this.save();
            return this.status();
        }
        catch (e) {
            this.data = before;
            this.save();
            throw e;
        }
    }
    private readFile(filePath: string): {
        file: OutlineFile;
        raw: string;
    } {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trimStart().startsWith('# '))
            throw new HiveError(`Outline header missing: ${filePath}`);
        const ids = [...raw.matchAll(/^\s*- .*?\[id:([a-z0-9]{8})\]/gm)].map(m => m[1]);
        if (new Set(ids).size !== ids.length)
            throw new HiveError(`Duplicate Bullet IDs: ${filePath}`);
        const lines = raw.split(/\r?\n/);
        let seenBullet = false;
        for (const line of lines.slice(1)) {
            if (/^\s*- /.test(line))
                seenBullet = true;
            else if (line.trim() && (!seenBullet || !/^\s/.test(line)))
                throw new HiveError(`Malformed outline: ${filePath}`);
        }
        const parsed = parseOutline(raw, filePath);
        return { file: parsed.file, raw };
    }
    private shared(file: OutlineFile): SharedFile {
        const bullets = copy(file.bullets);
        walk(bullets, b => { if (b.folder) {
            b.outline = b.id;
            delete b.folder;
        } });
        return { id: file.id, name: file.name, ownerId: this.deviceId, ...(file.parentId ? { parentId: file.parentId } : {}), bullets };
    }
    register(filePath: string, root = false) {
        if (!this.enabled)
            throw new HiveError('Create or join a hive first');
        const before = copy(this.data), base = copy(this.data.snapshot), next = copy(base);
        const visited = new Set<string>();
        const read = (p: string) => {
            p = path.resolve(p);
            if (visited.has(p))
                return;
            visited.add(p);
            const { file, raw } = this.readFile(p);
            const existing = next.files[file.id];
            if (existing && (existing.ownerId !== this.deviceId || this.data.mappings[file.id]?.path !== p))
                throw new HiveError(`Outline ID ${file.id} is already registered; copied files need explicit import`);
            const shared = this.shared(file);
            next.files[file.id] = shared;
            this.data.mappings[file.id] = { path: p, raw, baseline: copy(shared) };
            walk(file.bullets, b => { if (b.folder)
                read(folderFilePath(b.folder, b.text)); });
            return shared;
        };
        try {
            const added = read(filePath)!;
            if (!next.rootFileId || root)
                next.rootFileId = added.id;
            else if (added.id !== next.rootFileId) {
                const rootFile = next.files[next.rootFileId];
                let found = false;
                for (const f of Object.values(next.files))
                    walk(f.bullets, b => { if (b.id === added.id)
                        found = true; });
                if (!found)
                    rootFile.bullets.push({ id: added.id, text: added.name, outline: added.id, children: [] });
            }
            this.submit([{ id: randomUUID(), replicaId: this.deviceId, base, next }]);
            this.save();
            return this.response();
        }
        catch (e) {
            this.data = before;
            this.save();
            throw e;
        }
    }
    private ownedBullet(id: string) {
        for (const file of Object.values(this.data.snapshot.files)) {
            const found = findBullet(file.bullets, id);
            if (found) {
                if (file.ownerId !== this.deviceId)
                    throw new HiveError('Connect to the owning computer for filesystem changes', 409);
                return { file, ...found };
            }
        }
        throw new HiveError('Bullet not found', 404);
    }
    toFolder(id: string, directory: string) {
        const loc = this.ownedBullet(id);
        if (loc.bullet.outline)
            throw new HiveError('Already a Folder Bullet');
        const folder = path.resolve(directory);
        if (!fs.statSync(folder).isDirectory())
            throw new HiveError('Directory required');
        const target = folderFilePath(folder, loc.bullet.text);
        if (fs.existsSync(target))
            throw new HiveError('An Outline File already exists at the destination', 409);
        const base = copy(this.data.snapshot), next = copy(base), bullet = findBullet(next.files[loc.file.id].bullets, id)!.bullet;
        const shared: SharedFile = { id, name: bullet.text, ownerId: this.deviceId, parentId: loc.parent?.id ?? loc.file.id, bullets: bullet.children };
        next.files[id] = shared;
        bullet.children = [];
        bullet.outline = id;
        const raw = serializeOutline({ path: target, ...shared });
        // Exclusive creation preserves an existing file even if another process wins a race.
        fs.writeFileSync(target, raw, { flag: 'wx', mode: 0o600 });
        this.data.mappings[id] = { path: target, raw, baseline: copy(shared) };
        try {
            this.submit([{ id: randomUUID(), replicaId: this.deviceId, base, next }]);
        }
        catch (e) {
            delete this.data.mappings[id];
            throw e;
        }
        return copy(bullet);
    }
    inline(id: string) {
        const loc = this.ownedBullet(id), childId = loc.bullet.outline;
        if (!childId)
            throw new HiveError('Not a Folder Bullet');
        const child = this.data.snapshot.files[childId];
        if (!child || child.ownerId !== this.deviceId)
            throw new HiveError('Both files must be owned by this computer to inline', 409);
        this.ingest();
        const base = copy(this.data.snapshot), next = copy(base), bullet = findBullet(next.files[loc.file.id].bullets, id)!.bullet;
        bullet.children = copy(next.files[childId].bullets);
        delete bullet.outline;
        delete next.files[childId];
        const mapping = this.data.mappings[childId];
        this.submit([{ id: randomUUID(), replicaId: this.deviceId, base, next }]);
        // Keep the detached file as a recovery copy, and stop watching its old content.
        if (mapping) {
            delete this.data.mappings[childId];
            delete this.data.acks[childId];
            this.save();
        }
        return copy(bullet);
    }
    moveFolder(id: string, directory: string) {
        const mapping = this.data.mappings[id], file = this.data.snapshot.files[id];
        if (!mapping || !file || file.ownerId !== this.deviceId)
            throw new HiveError('Connect to the owning computer to move this file', 409);
        const target = folderFilePath(path.resolve(directory), file.name);
        if (!fs.statSync(path.dirname(target)).isDirectory())
            throw new HiveError('Directory required');
        if (target !== mapping.path) {
            if (fs.existsSync(target))
                throw new HiveError('Destination already exists', 409);
            this.relocate(mapping, target);
        }
        return { id, text: file.name, outline: id, folder: path.dirname(target), children: [] };
    }
    relink(id: string, filePath: string) {
        const mapping = this.data.mappings[id];
        if (!mapping)
            throw new HiveError('Connect to the owning computer to relink', 409);
        const target = path.resolve(filePath), { file } = this.readFile(target);
        if (file.id !== id)
            throw new HiveError('Selected file has a different Outline File ID', 409);
        mapping.path = target;
        delete mapping.error;
        this.save();
        return { id, text: file.name, outline: id, folder: path.dirname(target), children: [] };
    }
    submit(operations: HiveOperation[], author?: string) {
        if (!this.enabled)
            throw new HiveError('Hive not configured');
        if (!Array.isArray(operations) || operations.length > 100)
            throw new HiveError('Expected at most 100 operations');
        const before = copy(this.data);
        try {
            for (const op of operations) {
                this.validate(op, author);
                const digest = hash(op), receipt = this.data.receipts[op.id];
                if (receipt) {
                    if (receipt !== digest)
                        throw new HiveError('Operation ID reused with different content', 409);
                    continue;
                }
                this.data.snapshot = applyHiveOperation(this.data.snapshot, op);
                this.data.receipts[op.id] = digest;
                if (this.data.role === 'hub') {
                    this.data.cursor++;
                    this.data.checkpoint = hash(this.data.snapshot);
                    this.data.checkpoints![this.data.cursor]=this.data.checkpoint;
                    this.data.history.push({ cursor: this.data.cursor, operation: copy(op), checkpoint: this.data.checkpoint });
                    this.data.confirmed = copy(this.data.snapshot);
                }
                else
                    this.data.outbox.push(copy(op));
            }
            this.save();
        }
        catch (e) {
            this.data = before;
            throw e;
        }
        return this.response();
    }
    private validate(op: HiveOperation, author?: string) {
        if (!op || typeof op.id !== 'string' || !op.id || op.id.length > 200 || typeof op.replicaId !== 'string' || !op.base?.files || !op.next?.files || !Array.isArray(op.next.conflicts))
            throw new HiveError('Invalid operation');
        if (JSON.stringify(op).length > 8000000)
            throw new HiveError('Operation too large', 413);
        if (!op.next.rootFileId || !op.next.files[op.next.rootFileId])
            throw new HiveError('Shared root must reference an existing Outline File');
        for (const snapshot of [op.base, op.next]) {
            const identities = new Set<string>();
            for (const [id, f] of Object.entries(snapshot.files)) {
                if (!/^[a-z0-9]{8}$/.test(id) || !f || f.id !== id || !Array.isArray(f.bullets))
                    throw new HiveError('Invalid Outline File identity');
                const visit = (bs: Bullet[], depth = 0) => { if (depth > 200)
                    throw new HiveError('Outline too deeply nested'); for (const b of bs) {
                    if (!b || typeof b.id !== 'string' || !/^[a-z0-9]{8}$/.test(b.id) || typeof b.text !== 'string' || !Array.isArray(b.children) || b.folder)
                        throw new HiveError('Invalid shared bullet or local folder path');
                    if (b.outline && (!/^[a-z0-9]{8}$/.test(b.outline) || !snapshot.files[b.outline]))
                        throw new HiveError('Unknown Outline File reference', 409);
                    if (identities.has(b.id))
                        throw new HiveError('Duplicate Bullet ID', 409);
                    identities.add(b.id);
                    visit(b.children, depth + 1);
                } };
                visit(f.bullets);
            }
        }
        for (const [id, f] of Object.entries(op.next.files)) {
            if (!f || f.id !== id || typeof f.name !== 'string' || typeof f.ownerId !== 'string' || !Array.isArray(f.bullets))
                throw new HiveError('Invalid Outline File');
            const existing = this.data.snapshot.files[id];
            if (existing && existing.ownerId !== f.ownerId)
                throw new HiveError('File ownership cannot change', 409);
            if (!existing && f.ownerId !== (author ?? this.deviceId))
                throw new HiveError('Cannot register another device as owner', 403);
        }
    }
    invite(address: string) {
        if (this.data.role !== 'hub')
            throw new HiveError('Only the hub issues invitations');
        const url = checkAddress(address);
        const secret = token();
        this.data.invitations[hash(secret)] = { expires: Date.now() + 10 * 60000 };
        this.save();
        return Buffer.from(JSON.stringify({ version: 1, address: url, hiveId: this.data.hiveId, token: secret })).toString('base64url');
    }
    pair(secret: string, label: string) {
        const invitation = this.data.invitations[hash(secret)];
        if (this.data.role !== 'hub' || !invitation || invitation.expires < Date.now())
            throw new HiveError('Invitation expired or already used', 401);
        if (!label?.trim())
            throw new HiveError('Device label required');
        const deviceId = randomUUID(), credential = token();
        delete this.data.invitations[hash(secret)];
        this.data.devices[deviceId] = { label: label.trim(), tokenHash: hash(credential) };
        this.save();
        return { ...this.response(), deviceId, token: credential, name: this.data.name };
    }
    authenticate(credential: string) { const digest = hash(credential); return Object.entries(this.data.devices).find(([, d]) => !d.revoked && d.tokenHash === digest)?.[0] ?? null; }
    sessionMatches(secret: string) { const a = Buffer.from(secret), b = Buffer.from(this.sessionToken); return a.length === b.length && timingSafeEqual(a, b); }
    revoke(id: string) { if (this.data.role !== 'hub' || !this.data.devices[id])
        throw new HiveError('Unknown device'); this.data.devices[id].revoked = true; this.save(); }
    async join(invitation: string, label: string) {
        if (this.enabled)
            throw new HiveError('Already belongs to a hive');
        let parsed: any;
        try {
            parsed = JSON.parse(Buffer.from(invitation, 'base64url').toString());
        }
        catch {
            throw new HiveError('Invalid invitation');
        }
        if (parsed.version !== 1 || !parsed.hiveId || !parsed.token || !label?.trim())
            throw new HiveError('Invalid invitation or label');
        const address = checkAddress(parsed.address);
        const r = await request(address + '/api/hive/peer/pair', { token: parsed.token, label, hiveId: parsed.hiveId });
        if (r.hiveId !== parsed.hiveId)
            throw new HiveError('Wrong hive identity', 409);
        this.data = { ...this.data, role: 'client', label: label.trim(), name: r.name, hiveId: r.hiveId, deviceId: r.deviceId, generation: r.generation, cursor: r.cursor, snapshot: r.snapshot, confirmed: r.snapshot, address, credential: r.token, acks: r.acks, checkpoint: r.checkpoint };
        this.data.checkpoints![r.cursor]=r.checkpoint;
        this.connected = true;
        this.save();
        return this.status();
    }
    validateHistory(expected:any) {
        if(expected.hiveId!==this.data.hiveId)throw new HiveError('Wrong hive identity',409);
        if(expected.generation!==this.data.generation)throw new HiveError('Hub history changed; local data retained for recovery',409);
        const cursor=Number(expected.cursor);
        if(!Number.isSafeInteger(cursor)||cursor<0)throw new HiveError('Invalid history cursor');
        if(cursor>this.data.cursor)throw new HiveError('Hub history rollback detected; local data retained',409);
        const known=this.data.checkpoints?.[cursor]??this.data.history.find(entry=>entry.cursor===cursor)?.checkpoint;
        if(expected.checkpoint&&(!known||expected.checkpoint!==known))throw new HiveError('Hub history diverged or is unavailable; local data retained',409);
    }
    peerSync(deviceId: string, body: any) {
        if (this.data.role !== 'hub' || body.hiveId !== this.data.hiveId)
            throw new HiveError('Wrong hive', 409);
        if (body.version !== 1)
            throw new HiveError('Unsupported sync protocol', 426);
        this.validateHistory({...body,cursor:body.cursor??this.data.cursor});
        this.submit(body.operations ?? [], deviceId);
        for (const [id, value] of Object.entries(body.acks ?? {}) as [
            string,
            any
        ][]) {
            if (this.data.snapshot.files[id]?.ownerId === deviceId && value.ownerId === deviceId && typeof value.hash === 'string')
                this.data.acks[id] = value;
        }
        this.save();
        return { ...this.response(), accepted: (body.operations ?? []).map((op: HiveOperation) => op.id) };
    }
    async tick() {
        if (this.busy)
            return this.busy;
        if (!this.enabled || this.stopped)
            return;
        this.busy = this.runTick().finally(() => { this.busy = null; });
        return this.busy;
    }
    private async runTick() {
        this.ingest();
        if (this.data.role === 'client') {
            const pending: HiveOperation[] = [];
            let bytes = 0;
            for (const op of this.data.outbox) {
                const size = JSON.stringify(op).length;
                if (pending.length && (pending.length >= 100 || bytes + size > 8000000))
                    break;
                pending.push(copy(op));
                bytes += size;
            }
            try {
                const r = await request(this.data.address! + '/api/hive/peer/sync', { version: 1, hiveId: this.data.hiveId, generation: this.data.generation, cursor: this.data.cursor, checkpoint: this.data.checkpoint, operations: pending, acks: this.data.acks }, this.data.credential);
                if (r.hiveId !== this.data.hiveId)
                    throw new HiveError('Wrong hive identity');
                if (r.generation !== this.data.generation || r.cursor < this.data.cursor)
                    throw new HiveError('Hub history changed or rolled back; local edits retained for recovery', 409);
                const accepted = new Set<string>(r.accepted ?? []);
                this.data.outbox = this.data.outbox.filter(op => !accepted.has(op.id));
                this.data.confirmed = r.snapshot;
                this.data.snapshot = copy(r.snapshot);
                for (const op of this.data.outbox)
                    this.data.snapshot = applyHiveOperation(this.data.snapshot, op);
                this.data.cursor = r.cursor;
                this.data.generation = r.generation;
                this.data.checkpoint = r.checkpoint;
                this.data.checkpoints![r.cursor]=r.checkpoint;
                this.data.acks = r.acks;
                this.connected = true;
                this.error = null;
                this.save();
            }
            catch (e) {
                this.connected = false;
                this.error = (e as Error).message;
            }
        }
        this.materialize();
        this.save();
    }
    private ingest() {
        for (const [id, m] of Object.entries(this.data.mappings)) {
            try {
                if (m.relocation)
                    this.recoverRelocation(m);
                if (m.intent)
                    this.recover(m);
                const { file, raw } = this.readFile(m.path);
                if (file.id !== id)
                    throw new HiveError('Outline File ID changed; relink required');
                if (raw === m.raw) {
                    delete m.error;
                    continue;
                }
                const changed = this.shared(file), base = copy(this.data.snapshot);
                // A pending transfer can leave a source disk copy after the logical move.
                // Reconstruct its historical placement globally, without duplicate IDs.
                const historicalIds = new Set<string>();
                walk(m.baseline.bullets, b => historicalIds.add(b.id));
                const withoutHistorical = (bs: Bullet[]): Bullet[] => bs.flatMap(b => historicalIds.has(b.id) ? withoutHistorical(b.children) : [{ ...b, children: withoutHistorical(b.children) }]);
                for (const f of Object.values(base.files))
                    if (f.id !== id)
                        f.bullets = withoutHistorical(f.bullets);
                base.files[id] = copy(m.baseline);
                const next = copy(base);
                next.files[id] = changed;
                this.submit([{ id: randomUUID(), replicaId: this.deviceId, base, next }]);
                const active = this.data.mappings[id];
                active.raw = raw;
                active.baseline = copy(changed);
                delete active.error;
                this.save();
            }
            catch (e) {
                this.data.mappings[id].error = (e as Error).message;
            }
        }
    }
    private relocate(m: Mapping, target: string) {
        m.relocation = { from: m.path, to: target, raw: fs.readFileSync(m.path, 'utf8') };
        this.save();
        this.recoverRelocation(m);
    }
    private recoverRelocation(m: Mapping) {
        const r = m.relocation!;
        if (!fs.existsSync(r.to)) {
            if (fs.readFileSync(r.from, 'utf8') !== r.raw)
                throw new HiveError('Source changed during relocation; needs review');
            // Exclusive copy works across volumes and never overwrites a collision.
            fs.copyFileSync(r.from, r.to, fs.constants.COPYFILE_EXCL);
            const fd = fs.openSync(r.to, 'r');
            try {
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
        }
        if (fs.readFileSync(r.to, 'utf8') !== r.raw)
            throw new HiveError('Destination changed during relocation; needs review');
        m.path = r.to;
        this.save();
        if (fs.existsSync(r.from)) {
            if (fs.readFileSync(r.from, 'utf8') !== r.raw)
                throw new HiveError('Source changed during relocation; both copies retained');
            fs.unlinkSync(r.from);
        }
        delete m.relocation;
        this.save();
    }
    private recover(m: Mapping) {
        const intent = m.intent!;
        const actual = fs.existsSync(intent.target) ? fs.readFileSync(intent.target, 'utf8') : null;
        if (actual === intent.after) {
            m.path = intent.target;
            m.raw = intent.after;
            m.baseline = intent.file;
            m.written = hash(intent.file);
            delete m.intent;
            this.save();
        }
        else if (actual !== intent.before) {
            throw new HiveError('Interrupted write differs from recovery copy; manual review required');
        }
        else {
            delete m.intent;
            this.save();
        }
    }
    private materialize() {
        // Rename owned child files before serializing their parent references.
        for (const [id, m] of Object.entries(this.data.mappings)) {
            const file = this.data.snapshot.files[id];
            if (!file || id === this.data.snapshot.rootFileId || file.name === m.baseline.name || m.error)
                continue;
            const target = folderFilePath(path.dirname(m.path), file.name);
            if (target === m.path)
                continue;
            try {
                if (fs.existsSync(target))
                    throw new HiveError('Rename destination already exists');
                if (fs.readFileSync(m.path, 'utf8') !== m.raw)
                    throw new HiveError('File changed during rename; retrying');
                this.relocate(m, target);
            }
            catch (e) {
                m.error = (e as Error).message;
            }
        }
        const locations = new Map<string, string>();
        for (const f of Object.values(this.data.snapshot.files))
            walk(f.bullets, b => locations.set(b.id, f.id));
        for (const [id, m] of Object.entries(this.data.mappings)) {
            const shared = this.data.snapshot.files[id];
            if (!shared || shared.ownerId !== this.deviceId || m.error)
                continue;
            try {
                let waiting = false;
                walk(m.baseline.bullets, b => { const destination = locations.get(b.id); if (destination && destination !== id && this.data.acks[destination]?.hash !== hash(this.data.snapshot.files[destination]))
                    waiting = true; });
                if (waiting) {
                    m.error = 'Waiting for destination file write before removing source';
                    continue;
                }
                const bullets = copy(shared.bullets);
                walk(bullets, b => { if (b.outline) {
                    const target = this.data.mappings[b.outline];
                    if (target && folderFilePath(path.dirname(target.path), b.text) === target.path) {
                        b.folder = path.dirname(target.path);
                        delete b.outline;
                    }
                } });
                const output = serializeOutline({ path: m.path, id: shared.id, name: shared.name, parentId: shared.parentId, bullets });
                const actual = fs.readFileSync(m.path, 'utf8');
                if (actual !== m.raw) {
                    m.error = 'File changed during sync; retrying';
                    continue;
                }
                if (actual !== output) {
                    const backupDir = path.join(this.dir, 'recovery');
                    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
                    fs.writeFileSync(path.join(backupDir, `${id}-${hash(actual)}.lister`), actual, { mode: 0o600 });
                    m.intent = { before: actual, after: output, file: copy(shared), target: m.path };
                    this.save();
                    const temp = m.path + '.hive-' + randomUUID();
                    const fd = fs.openSync(temp, 'wx', 0o600);
                    try {
                        fs.writeFileSync(fd, output);
                        fs.fsyncSync(fd);
                    }
                    finally {
                        fs.closeSync(fd);
                    }
                    if (fs.readFileSync(m.path, 'utf8') !== actual) {
                        fs.unlinkSync(temp);
                        delete m.intent;
                        throw new HiveError('File changed during write; retrying');
                    }
                    fs.renameSync(temp, m.path);
                }
                m.raw = output;
                m.baseline = copy(shared);
                m.written = hash(shared);
                delete m.intent;
                delete m.error;
                this.data.acks[id] = { ownerId: this.deviceId, hash: hash(shared) };
                this.save();
            }
            catch (e) {
                m.error = (e as Error).message;
            }
        }
    }
    close() { this.stopped = true; this.db.close(); }
    async stop() { this.stopped = true; await this.busy; this.db.close(); }
}
export function checkAddress(address: string) { let u: URL; try {
    u = new URL(address);
}
catch {
    throw new HiveError('Invalid hub address');
} if (u.username || u.password || u.search || u.hash)
    throw new HiveError('Use a plain hub origin'); if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    throw new HiveError('Hub connections require HTTPS (except loopback)'); return u.origin; }
async function request(url: string, body: unknown, credential?: string) { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); const data = await res.json() as any; if (!res.ok)
    throw new HiveError(data.error ?? `Sync failed (${res.status})`, res.status); return data; }
