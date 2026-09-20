import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { HiveAgent } from '../src/hive/agent.js';
import { registerHiveRoutes } from '../src/hive/routes.js';
async function pair(t: any) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-pair-'));
    const miniFile = path.join(dir, 'mini.lister'), macFile = path.join(dir, 'mac.lister');
    fs.writeFileSync(miniFile, '# Mini [id:miniroot]\n- mini task [id:minibull]\n');
    fs.writeFileSync(macFile, '# Mac [id:macroot0]\n- mac task [id:macbull0]\n');
    const mini = new HiveAgent(path.join(dir, 'mini')), mac = new HiveAgent(path.join(dir, 'mac'));
    mini.create('Hive', 'Mini', miniFile);
    const app = Fastify();
    registerHiveRoutes(app, mini, miniFile, async () => { });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    await mac.join(mini.invite(address), 'Mac');
    mac.register(macFile);
    await mac.tick();
    await mini.tick();
    t.after(async () => { await mac.stop(); await mini.stop(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { mini, mac, miniFile, macFile, app, address };
}
test('two agents share files, remote edit reaches owner, outside edits return to hub', async (t) => {
    const { mini, mac, macFile } = await pair(t);
    assert.equal(Object.keys(mini.response().snapshot.files).length, 2);
    const base = mini.response().snapshot, next = structuredClone(base);
    next.files.macroot0.bullets[0].text = 'edited at mini';
    mini.submit([{ id: 'remote1', replicaId: 'mini-browser', base, next }]);
    await mac.tick();
    assert.match(fs.readFileSync(macFile, 'utf8'), /edited at mini/);
    fs.writeFileSync(macFile, fs.readFileSync(macFile, 'utf8').replace('edited at mini', 'agent changed disk'));
    await mac.tick();
    assert.equal(mini.response().snapshot.files.macroot0.bullets[0].text, 'agent changed disk');
});
test('move across owners writes destination before removing source', async (t) => {
    const { mini, mac, miniFile, macFile } = await pair(t);
    const base = mini.response().snapshot, next = structuredClone(base);
    const [moved] = next.files.miniroot.bullets.splice(0, 1);
    next.files.macroot0.bullets.push(moved);
    mini.submit([{ id: 'move1', replicaId: 'browser', base, next }]);
    await mini.tick();
    assert.match(fs.readFileSync(miniFile, 'utf8'), /minibull/);
    await mac.tick();
    assert.match(fs.readFileSync(macFile, 'utf8'), /minibull/);
    await mac.tick();
    await mini.tick();
    assert.doesNotMatch(fs.readFileSync(miniFile, 'utf8'), /minibull/);
});
test('peer endpoint rejects credentials and HTTP legacy writes use parsed body', async (t) => {
    const { app } = await pair(t);
    const rejected = await app.inject({ method: 'POST', url: '/api/hive/peer/sync', payload: { version: 1 } });
    assert.equal(rejected.statusCode, 401);
    const res = await app.inject({ method: 'POST', url: '/api/bullets', payload: { filePath: 'hive:miniroot', text: 'via CLI', parentId: null, index: 1 } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().text, 'via CLI');
});
test('remote requests need credentials; cross-origin requests cannot use local privilege', async (t) => {
    const { app, mini } = await pair(t);
    const unauth = await app.inject({ url: '/api/hive/snapshot', remoteAddress: '192.0.2.1' });
    assert.equal(unauth.statusCode, 401);
    const forwarded = await app.inject({ url: '/api/hive/snapshot', headers: { 'x-forwarded-for': '192.0.2.1' } });
    assert.equal(forwarded.statusCode, 401);
    const authorized = await app.inject({ url: '/api/hive/snapshot', remoteAddress: '192.0.2.1', headers: { authorization: `Bearer ${mini.sessionToken}` } });
    assert.equal(authorized.statusCode, 200);
    const evil = await app.inject({ method: 'POST', url: '/api/hive/create', headers: { origin: 'https://evil.example' }, payload: { name: 'bad', label: 'bad' } });
    assert.equal(evil.statusCode, 403);
});
test('offline changes survive client restart then sync without duplication', async (t) => {
    const { mini, mac, app, macFile } = await pair(t);
    await app.close();
    const base = mac.response().snapshot, next = structuredClone(base);
    next.files.macroot0.bullets.push({ id: 'newbull0', text: 'offline', children: [] });
    mac.submit([{ id: 'offline1', replicaId: 'browser', base, next }]);
    await mac.tick();
    assert.equal(mac.status().pending, 1);
    assert.match(fs.readFileSync(macFile, 'utf8'), /offline/);
    const dir = mac.dir;
    await mac.stop();
    const reopened = new HiveAgent(dir);
    try {
        assert.equal(reopened.status().pending, 1);
        assert.equal(reopened.response().snapshot.files.macroot0.bullets.filter(b => b.id === 'newbull0').length, 1);
        mini.peerSync(reopened.deviceId, { version: 1, hiveId: mini.response().hiveId, generation: mini.response().generation, operations: reopened.exportData().outbox, acks: {} });
        mini.peerSync(reopened.deviceId, { version: 1, hiveId: mini.response().hiveId, generation: mini.response().generation, operations: reopened.exportData().outbox, acks: {} });
        assert.equal(mini.response().snapshot.files.macroot0.bullets.filter(b => b.id === 'newbull0').length, 1);
    }
    finally {
        await reopened.stop();
    }
});
test('more than 100 offline operations drain in bounded batches', async (t) => {
    const { mini, mac } = await pair(t);
    for (let i = 0; i < 101; i++) {
        const base = mac.response().snapshot, next = structuredClone(base);
        next.files.macroot0.bullets[0].text = `edit ${i}`;
        mac.submit([{ id: `batch-${i}`, replicaId: 'browser', base, next }]);
    }
    await mac.tick();
    assert.equal(mac.status().pending, 1);
    await mac.tick();
    assert.equal(mac.status().pending, 0);
    assert.equal(mini.response().snapshot.files.macroot0.bullets[0].text, 'edit 100');
});
test('hub refuses rollback cursors before accepting edits', async (t) => {
    const { mini, mac } = await pair(t);
    assert.throws(() => mini.peerSync(mac.deviceId, { version: 1, hiveId: mini.response().hiveId, generation: mini.response().generation, cursor: mini.response().cursor + 1, operations: [], acks: {} }), /history|rollback/i);
});
test('history checkpoints detect divergent restored history even at the same cursor', async (t) => {
    const { mini, mac } = await pair(t);
    assert.throws(() => mini.peerSync(mac.deviceId, { version: 1, hiveId: mini.response().hiveId, generation: mini.response().generation, cursor: mini.response().cursor, checkpoint: 'divergent-history', operations: [], acks: {} }), /diverged/);
});
test('client retains acknowledged edits after an older hub database is restored', async (t) => {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-restore-')), file = path.join(dir, 'root.lister');
    fs.writeFileSync(file, '# Root [id:root0001]\n- original [id:bull0001]\n');
    let hub = new HiveAgent(path.join(dir, 'hub'));
    const client = new HiveAgent(path.join(dir, 'client'));
    hub.create('Test', 'Hub', file);
    let app = Fastify();
    registerHiveRoutes(app, hub, file, async () => { });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    await client.join(hub.invite(address), 'Client');
    const sqlpath = path.join(dir, 'hub', 'hive.sqlite');
    let db = new DatabaseSync(sqlpath);
    const backup = (db.prepare('SELECT value FROM state WHERE id=1').get() as any).value;
    db.close();
    const base = client.response().snapshot, next = structuredClone(base);
    next.files.root0001.bullets[0].text = 'precious acknowledged edit';
    client.submit([{ id: 'edit', replicaId: 'browser', base, next }]);
    await client.tick();
    assert.equal(client.status().pending, 0);
    await app.close();
    await hub.stop();
    db = new DatabaseSync(sqlpath);
    db.prepare('UPDATE state SET value=? WHERE id=1').run(backup);
    db.close();
    hub = new HiveAgent(path.join(dir, 'hub'));
    app = Fastify();
    registerHiveRoutes(app, hub, file, async () => { });
    await app.listen({ host: '127.0.0.1', port: Number(new URL(address).port) });
    try {
        await client.tick();
        if (!client.status().error?.includes('history')) await client.tick();
        assert.equal(client.response().snapshot.files.root0001.bullets[0].text, 'precious acknowledged edit');
        assert.match(client.status().error!, /history/);
        assert.match(JSON.stringify(client.exportData()), /precious acknowledged edit/);
    }
    finally {
        await client.stop();
        await app.close();
        await hub.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
test('hive CLI-compatible OPML import preserves imported children',async t=>{
 const {app}=await pair(t);
 // The application registers this parser in production; this isolated route host mirrors it.
 // Fastify is already listening, so send a JSON string accepted by the same handler.
 const xml='<?xml version="1.0"?><opml version="2.0"><body><outline text="Imported"><outline text="Child"/></outline></body></opml>';
 const response=await app.inject({method:'POST',url:'/api/import/opml',payload:JSON.stringify(xml),headers:{'content-type':'application/json'}});
 assert.equal(response.statusCode,200,response.body);assert.equal(response.json().imported,1);
 const root=await app.inject('/api/root');assert.ok(root.json().bullets.some((b:any)=>b.text==='Imported'&&b.children[0].text==='Child'));
});
test('browser preflight rejects divergent history before returning a snapshot',async t=>{
 const {app,mini}=await pair(t);const state=mini.response();
 const q=new URLSearchParams({hiveId:state.hiveId,generation:state.generation,cursor:String(state.cursor),checkpoint:'older-divergent-history'});
 const response=await app.inject(`/api/hive/snapshot?${q}`);assert.equal(response.statusCode,409);assert.match(response.body,/history/);
 const op={id:'unaccepted',replicaId:'browser',base:state.snapshot,next:state.snapshot};
 const posted=await app.inject({method:'POST',url:'/api/hive/operations',payload:{operations:[op],history:Object.fromEntries(q)}});assert.equal(posted.statusCode,409);
});
test('failed hive creation does not disable standalone file watching',async t=>{
 const {Store}=await import('../src/store.js');const {Search}=await import('../src/search.js');const {Admin}=await import('../src/admin.js');const {buildApp}=await import('../src/app.js');const {loadConfig}=await import('../src/config.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hive-create-failure-'));const cfg=loadConfig(dir);
 const store=new Store(cfg,{debounceMs:0});const agent=new HiveAgent(path.join(cfg.listerDir,'hive'));
 const app=buildApp({store,search:new Search(),admin:new Admin(store),hive:agent,onHiveEnable:()=>store.close(),beforeHiveEnable:()=>store.flush(),webDist:'/missing'});
 t.after(async()=>{await app.close();await store.close();agent.close();fs.rmSync(dir,{recursive:true,force:true});});
 await app.ready();await store.root();await store.flush();
 const response=await app.inject({method:'POST',url:'/api/hive/create',payload:{name:'',label:'Mini'}});assert.equal(response.statusCode,400);assert.equal(agent.enabled,false);
 const raw=fs.readFileSync(cfg.rootFile,'utf8');fs.writeFileSync(cfg.rootFile,raw+'- watched after failure [id:watch000]\n');
 for(let i=0;i<30;i++){if((await store.root()).bullets.some(b=>b.id==='watch000'))break;await new Promise(resolve=>setTimeout(resolve,40));}
 assert.ok((await store.root()).bullets.some(b=>b.id==='watch000'));
});
test('standalone remote browser can discover disabled hive without a token',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hive-standalone-'));const agent=new HiveAgent(dir),app=Fastify();registerHiveRoutes(app,agent,path.join(dir,'root.lister'),async()=>{});
 t.after(async()=>{await app.close();agent.close();fs.rmSync(dir,{recursive:true,force:true});});
 const response=await app.inject({url:'/api/hive/status',remoteAddress:'192.0.2.1'});assert.equal(response.statusCode,200);assert.equal(response.json().enabled,false);
 const setup=await app.inject({url:'/api/hive/create',method:'POST',remoteAddress:'192.0.2.1',payload:{name:'Hive',label:'Remote'}});assert.equal(setup.statusCode,401);
});
