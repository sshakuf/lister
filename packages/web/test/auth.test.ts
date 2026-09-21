import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { BrowserReplica, IndexedDbStorage } from '../src/hive/replica.ts';
import * as http from '../src/hive/http.ts';

test('cookie requests and sign-out preserve offline edits while removing the recovery bearer',async()=>{
 const data=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)}});
 const replica=new BrowserReplica(new IndexedDbStorage('auth-'+crypto.randomUUID()));
 await replica.accept({hiveId:'h',deviceId:'d',generation:'g',cursor:0,acks:{},snapshot:{rootFileId:'root0000',files:{root0000:{id:'root0000',name:'Root',ownerId:'d',bullets:[]}},conflicts:[]}});
 await replica.edit(s=>{s.files.root0000.name='offline edit';});const before=await replica.read();
 const original=globalThis.fetch;let options:RequestInit|undefined;
 globalThis.fetch=async(_url,init)=>{options=init;return new Response('{"ok":true}');};
 try {http.setAccessToken('old');await http.logout();assert.equal(options?.credentials,'same-origin');assert.equal(data.size,0);assert.deepEqual(await replica.read(),before);}finally{globalThis.fetch=original;}
});
