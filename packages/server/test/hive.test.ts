import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HiveAgent } from '../src/hive/agent.js';
function setup(t: any) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lister-hive-test-'));
    const file = path.join(dir, 'root.lister');
    fs.writeFileSync(file, '# Projects [id:root0001]\n- original [id:bull0001]\n');
    const agent = new HiveAgent(path.join(dir, 'state'));
    t.after(() => { agent.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { dir, file, agent };
}
test('hub persists edits and deduplicates retries across restart', t => {
    const { dir, file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const base = agent.response().snapshot;
    const next = structuredClone(base);
    next.files.root0001.bullets[0].text = 'changed';
    const op = { id: 'op1', replicaId: 'browser', base, next };
    agent.submit([op]);
    agent.submit([op]);
    assert.equal(agent.response().cursor, 2);
    agent.close();
    const reopened = new HiveAgent(path.join(dir, 'state'));
    assert.equal(reopened.response().snapshot.files.root0001.bullets[0].text, 'changed');
    reopened.submit([op]);
    assert.equal(reopened.response().cursor, 2);
    reopened.close();
});
test('offline owner disk edit and remote edit preserve conflicting versions', async (t) => {
    const { file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const base = agent.response().snapshot, next = structuredClone(base);
    next.files.root0001.bullets[0].text = 'remote';
    agent.submit([{ id: 'remote', replicaId: 'phone', base, next }]);
    fs.writeFileSync(file, '# Projects [id:root0001]\n- disk edit [id:bull0001]\n');
    await agent.tick();
    assert.equal(agent.response().snapshot.conflicts.length, 1);
    assert.ok(JSON.stringify(agent.response().snapshot.conflicts).includes('disk edit'));
    assert.ok(fs.readFileSync(file, 'utf8').includes('remote'));
});
test('invitation is single use and credentials can be revoked', t => {
    const { file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const invitation = agent.invite('https://mini.example');
    const parsed = JSON.parse(Buffer.from(invitation, 'base64url').toString());
    const paired = agent.pair(parsed.token, 'Laptop');
    assert.ok(agent.authenticate(paired.token));
    assert.throws(() => agent.pair(parsed.token, 'Other'));
    agent.revoke(paired.deviceId);
    assert.equal(agent.authenticate(paired.token), null);
});
test('missing owner file is unavailable, never an outline deletion', async (t) => {
    const { file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    fs.unlinkSync(file);
    await agent.tick();
    assert.ok(agent.response().snapshot.files.root0001);
    assert.match(agent.status().fileStatus.root0001.error!, /missing|ENOENT/i);
});
test('owner can create a Folder Bullet file and rename without losing its ID', async (t) => {
    const { dir, file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const b = agent.toFolder('bull0001', dir);
    assert.equal(b.outline, 'bull0001');
    assert.ok(fs.existsSync(path.join(dir, 'original.lister')));
    const base = agent.response().snapshot, next = structuredClone(base);
    next.files.bull0001.name = 'Renamed';
    next.files.root0001.bullets[0].text = 'Renamed';
    agent.submit([{ id: 'rename', replicaId: 'browser', base, next }]);
    await agent.tick();
    assert.ok(fs.existsSync(path.join(dir, 'renamed.lister')));
    assert.match(fs.readFileSync(file, 'utf8'), /Renamed/);
});
test('rename collision preserves both physical files', async (t) => {
    const { dir, file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    agent.toFolder('bull0001', dir);
    fs.writeFileSync(path.join(dir, 'taken.lister'), 'precious');
    const base = agent.response().snapshot, next = structuredClone(base);
    next.files.bull0001.name = 'Taken';
    agent.submit([{ id: 'rename-collision', replicaId: 'browser', base, next }]);
    await agent.tick();
    assert.equal(fs.readFileSync(path.join(dir, 'taken.lister'), 'utf8'), 'precious');
    assert.match(agent.status().fileStatus.bull0001.error!, /exists/);
});
test('snapshot admission rejects invalid identity and dangling root', t => {
    const { file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const base = agent.response().snapshot, next = structuredClone(base);
    next.rootFileId = 'missing0';
    assert.throws(() => agent.submit([{ id: 'badroot', replicaId: 'browser', base, next }]), /root/i);
    const bad = structuredClone(base);
    bad.files['../escape'] = { ...bad.files.root0001, id: '../escape' };
    assert.throws(() => agent.submit([{ id: 'badid', replicaId: 'browser', base, next: bad }]), /identity/i);
});
test('interrupted file replacement resumes from a durable write intent', async (t) => {
    const { dir, file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    await agent.tick();
    agent.close();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'state', 'hive.sqlite'));
    const state = JSON.parse((db.prepare('SELECT value FROM state WHERE id=1').get() as any).value);
    const m = state.mappings.root0001, after = m.raw.replace('original', 'recovered');
    const shared = structuredClone(state.snapshot.files.root0001);
    shared.bullets[0].text = 'recovered';
    state.snapshot.files.root0001 = shared;
    state.confirmed = state.snapshot;
    m.intent = { before: m.raw, after, file: shared, target: file };
    db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    fs.writeFileSync(file, after);
    const resumed = new HiveAgent(path.join(dir, 'state'));
    try {
        await resumed.tick();
        assert.equal(resumed.response().snapshot.files.root0001.bullets[0].text, 'recovered');
        assert.equal(resumed.response().snapshot.conflicts.length, 0);
    }
    finally {
        await resumed.stop();
    }
});
test('malformed or duplicate IDs never get rewritten by materialization', async (t) => {
    const { file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const raw = '# Projects [id:root0001]\n- one [id:bull0001]\n- two [id:bull0001]\n';
    fs.writeFileSync(file, raw);
    await agent.tick();
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.match(agent.status().fileStatus.root0001.error!, /Duplicate/);
});
test('external edits to a stale transfer source follow the moved bullet by ID', async (t) => {
    const { dir, file, agent } = setup(t);
    agent.create('Test', 'Mini', file);
    const other = path.join(dir, 'other.lister');
    fs.writeFileSync(other, '# Other [id:other000]\n');
    agent.register(other);
    await agent.tick();
    const base = agent.response().snapshot, next = structuredClone(base);
    next.files.other000.bullets.push(next.files.root0001.bullets.shift()!);
    agent.submit([{ id: 'move', replicaId: 'browser', base, next }]);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('original', 'edited stale source'));
    await agent.tick();
    await agent.tick();
    assert.equal(agent.response().snapshot.files.other000.bullets[0].text, 'edited stale source');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /bull0001/);
    assert.match(fs.readFileSync(other, 'utf8'), /edited stale source/);
});
