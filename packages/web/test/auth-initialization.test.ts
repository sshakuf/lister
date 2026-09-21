import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { hive } from '../src/hive/client.ts';

test('initial 401 publishes sign-in state even before browser event listeners attach',async()=>{
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
 // No hive.start listener: startup must derive state from its own request result.
 Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('{"error":"Sign in"}',{status:401});
 try {
  await assert.rejects(hive.initialize(),/Sign in/);
  assert.equal(hive.view.authRequired,true);
  assert.equal(hive.view.initialized,true);
  assert.equal(hive.view.online,false);
 }finally{globalThis.fetch=original;}
});
