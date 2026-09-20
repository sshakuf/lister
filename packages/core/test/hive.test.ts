import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHiveOperation, emptyHive, type HiveSnapshot } from '../src/hive.ts';
import type { Bullet } from '../src/model.ts';
const b = (id: string, text = id, children: Bullet[] = []): Bullet => ({ id, text, children });
const hive = (bullets = [b('a')]): HiveSnapshot => ({ rootFileId: 'f', files: { f: {id:'f',name:'Root',ownerId:'owner',bullets}}, conflicts: [] });
const copy = <T>(x:T):T => structuredClone(x);
const apply = (current:HiveSnapshot,base:HiveSnapshot,next:HiveSnapshot,id='op') => applyHiveOperation(current,{id,replicaId:'phone',base,next});

test('merges separate fields and leaves all input snapshots untouched', () => {
  const base=hive(), current=copy(base), next=copy(base);
  current.files.f.bullets[0].date='2026-09-21'; next.files.f.bullets[0].text='offline';
  const result=apply(current,base,next);
  assert.equal(result.files.f.bullets[0].text,'offline'); assert.equal(result.files.f.bullets[0].date,'2026-09-21');
  assert.equal(current.files.f.bullets[0].text,'a'); assert.equal(result.conflicts.length,0);
});
test('same-field conflicts keep both candidates, coalesce identical edits, and replay stably',()=>{
  const base=hive(), current=copy(base), next=copy(base);
  current.files.f.bullets[0].text='hub'; next.files.f.bullets[0].text='phone';
  const result=apply(current,base,next);
  assert.equal(result.files.f.bullets[0].text,'hub');
  assert.equal(result.conflicts.length,1); assert.equal(result.conflicts[0].proposed,'phone'); assert.equal(result.conflicts[0].base,'a');
  assert.deepEqual(apply(result,base,next),result);
  assert.equal(apply(next,base,next).conflicts.length,0);
});
test('metadata removal merges with an unrelated note edit',()=>{
  const base=hive(); base.files.f.bullets[0].priority=1;
  const current=copy(base),next=copy(base); current.files.f.bullets[0].note='note'; delete next.files.f.bullets[0].priority;
  const result=apply(current,base,next); assert.equal(result.files.f.bullets[0].priority,undefined); assert.equal(result.files.f.bullets[0].note,'note');
});
test('delete versus edit preserves accepted content and complete recoverable proposals in both directions',()=>{
  const base=hive([b('p','parent',[b('c')])]), edited=copy(base), deleted=copy(base);
  edited.files.f.bullets[0].children[0].text='edited child'; deleted.files.f.bullets=[];
  const first=apply(edited,base,deleted); assert.equal(first.files.f.bullets[0].children[0].text,'edited child'); assert.ok(first.conflicts.length);
  const second=apply(deleted,base,edited); assert.deepEqual(second.files.f.bullets,[]); assert.ok(second.conflicts.length);
  assert.match(JSON.stringify(second.conflicts),/edited child/); assert.match(JSON.stringify(second.conflicts),/parent/);
});
test('parent deletion versus a new descendant is recoverable',()=>{
  const base=hive([b('p')]),deleted=copy(base),next=copy(base); deleted.files.f.bullets=[]; next.files.f.bullets[0].children.push(b('new','new child'));
  const result=apply(deleted,base,next); assert.deepEqual(result.files.f.bullets,[]); assert.ok(result.conflicts.length); assert.match(JSON.stringify(result.conflicts),/new child/);
});
test('cross-file move retains IDs and merges concurrent content',()=>{
  const base=hive([b('a','old',[b('child')])]); base.files.g={id:'g',name:'Other',ownerId:'other',bullets:[]};
  const current=copy(base),next=copy(base); current.files.f.bullets[0].text='new'; next.files.g.bullets=next.files.f.bullets; next.files.f.bullets=[];
  const result=apply(current,base,next); assert.deepEqual(result.files.f.bullets,[]); assert.equal(result.files.g.bullets[0].id,'a'); assert.equal(result.files.g.bullets[0].text,'new'); assert.equal(result.files.g.bullets[0].children[0].id,'child'); assert.equal(result.conflicts.length,0);
});
test('competing moves retain accepted placement with a recoverable alternative',()=>{
  const base=hive([b('a'),b('p'),b('q')]),current=copy(base),next=copy(base);
  current.files.f.bullets[1].children.push(current.files.f.bullets.shift()!);
  next.files.f.bullets[2].children.push(next.files.f.bullets.shift()!);
  const result=apply(current,base,next); assert.equal(result.files.f.bullets[0].children[0].id,'a'); assert.ok(result.conflicts.some(c=>c.field==='placement'));
});
test('concurrent reparenting cannot create a cycle',()=>{
  const base=hive([b('a'),b('b')]),current=hive([b('a','a',[b('b')])]),next=hive([b('b','b',[b('a')])]);
  const result=apply(current,base,next); assert.equal(result.files.f.bullets[0].id,'a'); assert.equal(result.files.f.bullets[0].children[0].id,'b'); assert.ok(result.conflicts.some(c=>c.field==='placement'));
});
test('independent insertions in one gap have deterministic ordering',()=>{
  const base=hive([b('a'),b('z')]),left=hive([b('a'),b('x'),b('z')]),right=hive([b('a'),b('y'),b('z')]);
  assert.deepEqual(apply(left,base,right).files.f.bullets.map(b=>b.id),['a','x','y','z']);
  assert.deepEqual(apply(right,base,left).files.f.bullets.map(b=>b.id),['a','x','y','z']);
});
test('reordering preserves intended sequence without treating insertions as competing moves',()=>{
  const base=hive([b('a'),b('b'),b('c')]),current=hive([b('a'),b('x'),b('b'),b('c')]),next=hive([b('c'),b('a'),b('b')]);
  const result=apply(current,base,next); assert.deepEqual(result.files.f.bullets.map(b=>b.id),['c','a','x','b']); assert.equal(result.conflicts.length,0);
});
test('resolution clears the observed conflict and is rechecked against fresh edits',()=>{
  const base=hive(),current=hive([b('a','hub')]),next=hive([b('a','phone')]); const conflicted=apply(current,base,next);
  const resolved=copy(conflicted); resolved.files.f.bullets[0].text='chosen'; resolved.conflicts=[];
  const op={id:'resolve',replicaId:'phone',base:conflicted,next:resolved,resolves:[conflicted.conflicts[0].id]};
  const result=applyHiveOperation(conflicted,op); assert.equal(result.files.f.bullets[0].text,'chosen'); assert.equal(result.conflicts.length,0);
  const fresh=copy(conflicted); fresh.files.f.bullets[0].text='fresh'; const stale=applyHiveOperation(fresh,op);
  assert.equal(stale.files.f.bullets[0].text,'fresh'); assert.ok(stale.conflicts.length); assert.match(JSON.stringify(stale.conflicts),/chosen/);
});
test('registering files into an empty hive preserves file and bullet identities',()=>{
  assert.deepEqual(apply(emptyHive(),emptyHive(),hive()),hive());
});

test('a move of an outline reference cannot introduce a cycle between files',()=>{
  const base=hive([{...b('g'),outline:'g'}]); base.files.g={id:'g',name:'Remote',ownerId:'other',bullets:[]};
  const next=copy(base); next.files.g.bullets=next.files.f.bullets; next.files.f.bullets=[];
  const result=apply(base,base,next);
  assert.equal(result.files.f.bullets[0]?.id,'g'); assert.deepEqual(result.files.g.bullets,[]);
  assert.ok(result.conflicts.some(c=>c.field==='placement')); assert.match(JSON.stringify(result.conflicts),/outline/);
});
test('colliding new parent identities do not attach new children to an unrelated accepted parent',()=>{
  const base=hive([]),current=hive([b('collision','accepted parent')]),next=hive([b('collision','proposed parent',[b('new','proposed child')])]);
  const result=apply(current,base,next); assert.deepEqual(result.files.f.bullets[0].children,[]);
  assert.match(JSON.stringify(result.conflicts),/proposed child/);
});
test('registration collision with different file metadata is reviewable',()=>{
  const base=emptyHive(),current=hive(),next=hive(); next.files.f.name='Different';
  const result=apply(current,base,next); assert.equal(result.files.f.name,'Root');
  assert.ok(result.conflicts.length); assert.match(JSON.stringify(result.conflicts),/Different/);
});
test('duplicate bullet identities across files are rejected before merging',()=>{
  const next=hive(); next.files.g={id:'g',name:'Other',ownerId:'other',bullets:[b('a')]};
  assert.throws(()=>apply(emptyHive(),emptyHive(),next),/Duplicate bullet identity/);
});
test('object property order is not treated as an edit when deleting unchanged data',()=>{
  const base=hive(),current=hive(),next=hive([]);
  current.files.f.bullets=[{text:'a',children:[],id:'a'}];
  const result=apply(current,base,next); assert.deepEqual(result.files.f.bullets,[]); assert.equal(result.conflicts.length,0);
});
test('a stale keep-current resolution does not dismiss a conflict after a fresh edit',()=>{
  const base=hive(),conflicted=apply(hive([b('a','hub')]),base,hive([b('a','phone')]));
  const current=copy(conflicted); current.files.f.bullets[0].text='fresh';
  const result=applyHiveOperation(current,{id:'resolve',replicaId:'r',base:conflicted,next:conflicted,resolves:[conflicted.conflicts[0].id]});
  assert.equal(result.files.f.bullets[0].text,'fresh'); assert.equal(result.conflicts.length,1);
});
test('existing bullet cannot be moved beneath a colliding rejected parent',()=>{
 const base=hive([b('existing')]),current=hive([b('existing'),b('p','accepted parent')]),next=hive([b('p','proposed parent',[b('existing')])]);
 const result=apply(current,base,next);assert.equal(result.files.f.bullets[0].id,'existing');assert.deepEqual(result.files.f.bullets[1].children,[]);assert.ok(result.conflicts.some(c=>c.field==='placement'));
});
test('later offline child addition retains dependency on a rejected parent creation',()=>{
 const base=hive([]),current=hive([b('p','accepted parent')]),next=hive([b('p','proposed parent')]);
 const result=apply(current,base,next),later=copy(next);later.files.f.bullets[0].children.push(b('new','private child'));
 const combined=applyHiveOperation(result,{id:'later',replicaId:'phone',base:next,next:later});
 assert.deepEqual(combined.files.f.bullets[0].children,[]);assert.match(JSON.stringify(combined.conflicts),/private child/);
});
test('ambiguous concurrent sibling reorders retain accepted ordering for review',()=>{
 const base=hive([b('a'),b('b'),b('c')]),current=hive([b('b'),b('a'),b('c')]),next=hive([b('b'),b('c'),b('a')]);
 const result=apply(current,base,next);assert.deepEqual(result.files.f.bullets.map(b=>b.id),['b','a','c']);assert.ok(result.conflicts.some(c=>c.field==='placement'));
});
test('rejected parent dependency survives intervening offline field edits',()=>{
 const base=hive([]),current=hive([b('p','accepted')]),created=hive([b('p','proposed')]);
 const first=applyHiveOperation(current,{id:'create',replicaId:'phone',base,next:created});
 const renamed=copy(created);renamed.files.f.bullets[0].text='proposed edited';
 const second=applyHiveOperation(first,{id:'edit',replicaId:'phone',base:created,next:renamed});
 const child=copy(renamed);child.files.f.bullets[0].children.push(b('child','private child'));
 const result=applyHiveOperation(second,{id:'child',replicaId:'phone',base:renamed,next:child});
 assert.deepEqual(result.files.f.bullets[0].children,[]);assert.ok(result.conflicts.some(c=>c.bulletId==='child'&&c.field==='placement'));
});
