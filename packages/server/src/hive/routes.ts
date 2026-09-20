import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { newId, opmlToBullets, splitMetadata, findBullet, insertBullet, removeBullet, updateBullet, moveBullet, walk, type Bullet, type OutlineFile } from '@lister/core';
import type { SharedFile } from '@lister/core/hive';
import { completeDirs } from '../fsdirs.js';
import { HiveAgent, HiveError } from './agent.js';
export function registerHiveRoutes(app: FastifyInstance, agent: HiveAgent, rootPath: string, onEnable: () => Promise<void>, beforeEnable: () => Promise<void> = async () => {}) {
    const local = (req: FastifyRequest) => { let host = ''; try {
        host = new URL(`http://${req.headers.host}`).hostname;
    }
    catch {
        return false;
    } return ['127.0.0.1', 'localhost', '[::1]'].includes(host) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) && !req.headers['x-forwarded-for'] && !req.headers.forwarded; };
    const authorized = (req: FastifyRequest) => {
        const bearer = req.headers.authorization?.replace(/^Bearer /, '');
        const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('lister_session='))?.slice(15);
        return local(req) || !!((bearer || cookie) && agent.sessionMatches(bearer || cookie!));
    };
    app.addHook('onRequest', async (req, reply) => {
        const url = req.url.split('?')[0];
        if (!url.startsWith('/api/') && url !== '/ws')
            return;
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host)
            return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
        if (url.startsWith('/api/hive/peer/'))
            return;
        if (url === '/api/health')
            return;
        if (url === '/api/hive/session')
            return;
        if (url === '/api/hive/status' && !agent.enabled) return;
        if (url === '/api/hive/status' && !authorized(req))
            return reply.code(401).send({ error: 'Enter the device access token to connect', locked: true });
        if ((agent.enabled || url.startsWith('/api/hive/')) && !authorized(req))
            return reply.code(401).send({ error: 'Device access token required' });
    });
    app.addHook('preHandler', async (req, reply) => {
        const url = req.url.split('?')[0];
        if (agent.enabled && url !== '/api/health' && url.startsWith('/api/') && !url.startsWith('/api/hive/')) {
            try {
                return reply.send(await legacy(agent, req));
            }
            catch (e) {
                const err = e as HiveError;
                return reply.code(err.status ?? 400).send({ error: err.message });
            }
        }
    });
    const handle = (fn: (req: any) => unknown) => async (req: any, reply: any) => { try {
        return await fn(req);
    }
    catch (e) {
        const err = e as HiveError;
        return reply.code(err.status ?? 400).send({ error: err.message });
    } };
    app.get('/api/hive/status', () => agent.status());
    app.get('/api/hive/access', handle(req => { if (!local(req))
        throw new HiveError('Access token is available only locally', 403); return { token: agent.sessionToken }; }));
    app.post('/api/hive/session', handle(async (req) => { if (!agent.sessionMatches(req.body?.token ?? ''))
        throw new HiveError('Invalid access token', 401); return { ok: true }; }));
    // Session uses a bearer token supplied by the client; no ambient cross-origin credential.
    app.post('/api/hive/create', handle(async (req) => { await beforeEnable(); const result = agent.create(req.body?.name, req.body?.label, rootPath); await onEnable(); return result; }));
    app.post('/api/hive/join', handle(async (req) => { const result = await agent.join(req.body?.invitation, req.body?.label); await onEnable(); return result; }));
    app.post('/api/hive/invite', handle(req => ({ invitation: agent.invite(req.body?.address) })));
    app.post('/api/hive/revoke', handle(req => { agent.revoke(req.body?.deviceId); return { ok: true }; }));
    app.post('/api/hive/register', handle(req => agent.register(req.body?.filePath)));
    app.get('/api/hive/snapshot', handle(req => {if(req.query?.cursor!==undefined)agent.validateHistory(req.query);return agent.response();}));
    app.get('/api/hive/export', handle(() => agent.exportData()));
    app.post('/api/hive/operations', handle(req => {if(req.body?.history)agent.validateHistory(req.body.history);return agent.submit(req.body?.operations);}));
    app.post('/api/hive/sync', handle(async () => { await agent.tick(); return agent.response(); }));
    app.post('/api/hive/peer/pair', handle(req => { if (req.body?.hiveId !== agent.response().hiveId)
        throw new HiveError('Wrong hive', 409); return agent.pair(req.body?.token ?? '', req.body?.label); }));
    app.post('/api/hive/peer/sync', handle(req => { const id = agent.authenticate(req.headers.authorization?.replace(/^Bearer /, '') ?? ''); if (!id)
        throw new HiveError('Invalid or revoked device credential', 401); return agent.peerSync(id, req.body); }));
}
export function publicFile(file: SharedFile): OutlineFile { return { id: file.id, name: file.name, parentId: file.parentId, path: `hive:${file.id}`, bullets: structuredClone(file.bullets) }; }
async function legacy(agent: HiveAgent, req: FastifyRequest) {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname, body = req.body as any;
    const base = agent.response().snapshot, next = structuredClone(base);
    const getFile = (p: string) => { const id = p?.startsWith('hive:') ? p.slice(5) : agent.fileIdForPath(p); const f = id ? next.files[id] : undefined; if (!f)
        throw new HiveError('Outline File not found', 404); return f; };
    const locate = (id: string) => { for (const file of Object.values(next.files)) {
        const loc = findBullet(file.bullets, id);
        if (loc)
            return { file, ...loc };
    } throw new HiveError('Bullet not found', 404); };
    const submit = () => agent.submit([{ id: randomUUID(), replicaId: agent.deviceId, base, next }]);
    if (route === '/api/fs/dirs')
        return { dirs: await completeDirs(url.searchParams.get('path') ?? '~/') };
    if (route === '/api/fs/recent')
        return { recent: [] };
    if (route === '/api/root')
        return publicFile(next.files[next.rootFileId!]);
    if (route === '/api/files' || route === '/api/files/reload')
        return publicFile(getFile(url.searchParams.get('path')!));
    if (route === '/api/search') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const hits: any[] = [];
        for (const f of Object.values(next.files))
            walk(f.bullets, b => { if (b.text.toLowerCase().includes(q))
                hits.push({ id: b.id, text: b.text, filePath: `hive:${f.id}`, fileName: f.name, path: [], done: b.done, outline: b.outline }); });
        return { hits };
    }
    if (route === '/api/import/opml' && req.method === 'POST') {
        const bullets = opmlToBullets(typeof body === 'string' ? body : String(body ?? ''));
        const parentId = url.searchParams.get('parentId');
        const loc = parentId ? locate(parentId) : null;
        const target = loc?.bullet.outline ? next.files[loc.bullet.outline] : loc?.file ?? next.files[next.rootFileId!];
        const parent = loc && !loc.bullet.outline ? loc.bullet.id : null;
        for (const bullet of bullets) target.bullets = insertBullet(target.bullets, parent, Number.MAX_SAFE_INTEGER, bullet);
        submit();
        return { imported: bullets.length, filePath: `hive:${target.id}` };
    }
    if (route === '/api/admin/folders')
        return { folders: Object.values(next.files).filter(f => f.id !== next.rootFileId).map(f => ({ id: f.id, text: f.name, folder: '', filePath: `hive:${f.id}`, inFile: `hive:${next.rootFileId}`, status: 'ok' })), orphans: [] };
    if (route === '/api/admin/adopt') {
        const result = agent.register(body.filePath);
        const file = Object.values(result.snapshot.files).find(f => agent.fileIdForPath(body.filePath) === f.id)!;
        return { id: file.id, text: file.name, outline: file.id, children: [] };
    }
    if (route === '/api/admin/move')
        return agent.moveFolder(body.id, body.folder);
    if (route === '/api/admin/relink')
        return agent.relink(body.id, body.filePath);
    if (route === '/api/bullets' && req.method === 'POST') {
        const f = getFile(body.filePath), { text, meta } = splitMetadata(body.text ?? '');
        const b: Bullet = { id: newId(), text, children: [] };
        if (meta.date)
            b.date = String(meta.date);
        if (meta.priority)
            b.priority = Number(meta.priority) as 1 | 2 | 3;
        if (meta.done !== undefined)
            b.done = meta.done === true ? '' : String(meta.done);
        f.bullets = insertBullet(f.bullets, body.parentId ?? null, body.index ?? Number.MAX_SAFE_INTEGER, b);
        submit();
        return b;
    }
    const match = route.match(/^\/api\/bullets\/([^/]+)(?:\/(move|to-folder|inline))?$/);
    if (match) {
        const loc = locate(match[1]);
        if (req.method === 'GET')
            return { bullet: loc.bullet, filePath: `hive:${loc.file.id}`, fileName: loc.file.name, parentId: loc.parent?.id ?? null, index: loc.index };
        if (match[2] === 'move') {
            const f = getFile(body.filePath);
            if (f.id === loc.file.id)
                f.bullets = moveBullet(f.bullets, loc.bullet.id, body.parentId, body.index);
            else {
                const { bullets, removed } = removeBullet(loc.file.bullets, loc.bullet.id);
                loc.file.bullets = bullets;
                f.bullets = insertBullet(f.bullets, body.parentId, body.index, removed!);
            }
            submit();
            return { ok: true };
        }
        if (match[2] === 'to-folder')
            return agent.toFolder(loc.bullet.id, body.folder);
        if (match[2] === 'inline')
            return agent.inline(loc.bullet.id);
        if (req.method === 'PATCH') {
            if (Object.keys(body).some(k => !['text', 'note', 'date', 'priority', 'done'].includes(k)))
                throw new HiveError('Unsupported bullet field');
            loc.file.bullets = updateBullet(loc.file.bullets, loc.bullet.id, body);
            if (loc.bullet.outline && typeof body.text === 'string' && next.files[loc.bullet.outline])
                next.files[loc.bullet.outline].name = body.text;
            submit();
            return findBullet(loc.file.bullets, loc.bullet.id)!.bullet;
        }
        if (req.method === 'DELETE') {
            loc.file.bullets = removeBullet(loc.file.bullets, loc.bullet.id).bullets;
            submit();
            return { ok: true, detached: !!loc.bullet.outline };
        }
    }
    throw new HiveError('This filesystem action is unavailable through the shared outline', 409);
}
