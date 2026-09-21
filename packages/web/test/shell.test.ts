import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { shellWorker } from '../service-worker.ts';
import { operationBatch } from '../src/hive/batch.ts';
import { emptyHive } from '@lister/core/hive';
test('built shell caches exact assets and never intercepts API, auth, or another origin',async()=>{
 const listeners:Record<string,Function>={};let cached:string[]=[];
 const self={location:{origin:'https://example.test'},addEventListener:(name:string,fn:Function)=>{listeners[name]=fn;},skipWaiting:()=>{},clients:{claim:()=>{}}};
 const caches={open:async()=>({addAll:async(paths:string[])=>{cached=paths;},match:async()=>new Response('shell')})};
 vm.runInNewContext(shellWorker(['index.html','assets/index-123.js','assets/index-456.css']),{self,caches,URL,Promise,fetch});
 await new Promise<void>(resolve=>listeners.install({waitUntil:(promise:Promise<void>)=>promise.then(resolve)}));
 assert.deepEqual(Array.from(cached),['/assets/index-123.js','/assets/index-456.css','/index.html']);
 for(const path of ['/api/hive/snapshot','/api/hive/session','/api/hive/auth/google/start','/api/hive/auth/google/callback?code=secret&state=state','https://other.test/assets/index-123.js']) {
  let intercepted=false;listeners.fetch({request:new Request(new URL(path,'https://example.test')),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
 }
 let intercepted=false;listeners.fetch({request:new Request('https://example.test/assets/index-123.js',{headers:{authorization:'Bearer token'}}),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
});
test('browser upload caps operation count and total encoded bytes',()=>{
 const operations=Array.from({length:101},(_,i)=>({id:String(i),replicaId:'r',base:emptyHive(),next:emptyHive()}));assert.equal(operationBatch(operations).length,100);
 const huge={...operations[0],replicaId:'x'.repeat(8*1024*1024)};assert.throws(()=>operationBatch([huge]),/too large/);assert.equal(operationBatch([operations[0],huge]).length,1);
});
