import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { applyHiveOperation, type HiveSnapshot } from '@lister/core/hive';
import { BrowserReplica, IndexedDbStorage, permanentId } from '../src/hive/replica.ts';
import { resolveConflict } from '../src/hive/conflicts.ts';
const snapshot = ():HiveSnapshot => ({rootFileId:'root0000',files:{root0000:{id:'root0000',name:'Root',ownerId:'owner',bullets:[{id:'bullet00',text:'original',children:[]}]}},conflicts:[]});
const response = (s=snapshot()) => ({snapshot:s,hiveId:'hive',deviceId:'device',generation:'generation',cursor:0,acks:{}});
const setup = async () => {const storage=new IndexedDbStorage(`test-${crypto.randomUUID()}`);const replica=new BrowserReplica(storage);await replica.accept(response());return {storage,replica};};
test('concurrent tabs persist edits and outbox in one serial transaction',async()=>{
 const {storage,replica}=await setup();const other=new BrowserReplica(storage);
 await Promise.all([replica.edit(s=>{s.files.root0000.bullets[0].text='changed';}),other.edit(s=>{s.files.root0000.bullets[0].note='note';})]);
 const state=await replica.read();assert.equal(state!.snapshot.files.root0000.bullets[0].text,'changed');assert.equal(state!.snapshot.files.root0000.bullets[0].note,'note');assert.equal(state!.outbox.length,2);
});
test('an upload acknowledgment retains edits made while request was in flight',async()=>{
 const {replica}=await setup();await replica.edit(s=>{s.files.root0000.bullets[0].text='first';});const sent=(await replica.read())!.outbox;
 await replica.edit(s=>{s.files.root0000.bullets[0].note='second';});
 await replica.accept(response(sent[0].next),sent.map(o=>o.id));const state=(await replica.read())!;
 assert.equal(state.outbox.length,1);assert.equal(state.snapshot.files.root0000.bullets[0].text,'first');assert.equal(state.snapshot.files.root0000.bullets[0].note,'second');
});
test('offline restart retains projection, operation IDs and permanent bullet IDs',async()=>{
 const {storage,replica}=await setup();const id=permanentId();assert.match(id,/^[a-z0-9]{8}$/);
 await replica.edit(s=>{s.files.root0000.bullets.push({id,text:'offline',children:[]});});const before=(await replica.read())!;
 const restarted=new BrowserReplica(new IndexedDbStorage(storage.name));assert.deepEqual(await restarted.read(),before);
});
test('failed edits leave neither a partial projection nor an outbox operation',async()=>{
 const {replica}=await setup();await assert.rejects(replica.edit(s=>{s.files.root0000.name='bad';throw new Error('abort');}));const s=(await replica.read())!;assert.equal(s.snapshot.files.root0000.name,'Root');assert.equal(s.outbox.length,0);
});
test('different hive identity is rejected without discarding unsent edits',async()=>{
 const {replica}=await setup();await replica.edit(s=>{s.files.root0000.name='offline';});await assert.rejects(replica.accept({...response(),hiveId:'other'}),/different hive/i);assert.equal((await replica.read())!.outbox.length,1);
});
test('field resolution changes only selected value and retains unrelated edits',()=>{
 const base=snapshot(),remote=snapshot(),proposal=snapshot();remote.files.root0000.bullets[0].text='remote';proposal.files.root0000.bullets[0].text='proposal';const s=applyHiveOperation(remote,{id:'op',replicaId:'r',base,next:proposal});s.files.root0000.bullets[0].note='later';
 const next=resolveConflict(s,s.conflicts[0].id,'proposed');assert.equal(next.files.root0000.bullets[0].text,'proposal');assert.equal(next.files.root0000.bullets[0].note,'later');
 const result=applyHiveOperation(s,{id:'resolution',replicaId:'r',base:s,next,resolves:[s.conflicts[0].id]});assert.equal(result.conflicts.length,0);
});
test('structural recovery restores deleted candidate without replacing unrelated content',()=>{
 const base=snapshot(),remote=snapshot(),proposal=snapshot();remote.files.root0000.bullets=[];proposal.files.root0000.bullets[0].text='edited';const s=applyHiveOperation(remote,{id:'op',replicaId:'r',base,next:proposal});s.files.root0000.bullets.push({id:'other000',text:'keep me',children:[]});
 const next=resolveConflict(s,s.conflicts[0].id,'proposed');assert.deepEqual(next.files.root0000.bullets.map(b=>b.text),['edited','keep me']);
});

test('ordered catch-up keeps an unsent chain of edits after acknowledging a prefix',async()=>{
 const {replica}=await setup();for(let i=0;i<5;i++)await replica.edit(s=>{s.files.root0000.bullets[0].text=`edit ${i}`;});const sent=(await replica.read())!.outbox;
 let remote=snapshot();for(const operation of sent.slice(0,2))remote=applyHiveOperation(remote,operation);
 await replica.accept(response(remote),sent.slice(0,2).map(o=>o.id));const state=(await replica.read())!;assert.equal(state.outbox.length,3);assert.equal(state.snapshot.files.root0000.bullets[0].text,'edit 4');assert.equal(state.snapshot.conflicts.length,0);
});

test('server history rollback or replacement preserves the last durable browser state',async()=>{
 const {replica}=await setup();await replica.accept({...response(),cursor:10});await replica.edit(s=>{s.files.root0000.bullets[0].text='offline';});const before=await replica.read();
 await assert.rejects(replica.accept({...response(),cursor:9}),/history|older/i);assert.deepEqual(await replica.read(),before);
 await assert.rejects(replica.accept({...response(),cursor:11,generation:'replaced'}),/history|generation/i);assert.deepEqual(await replica.read(),before);
});

test('equal-cursor divergent checkpoints preserve local history',async()=>{
 const {replica}=await setup();await replica.accept({...response(),checkpoint:'confirmed-A'});const before=await replica.read();await assert.rejects(replica.accept({...response(),checkpoint:'confirmed-B'}),/history/i);assert.deepEqual(await replica.read(),before);
});
