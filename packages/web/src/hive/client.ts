import { useSyncExternalStore } from 'react';
import type { HiveSnapshot, SharedFile } from '@lister/core/hive';
import type { Bullet, BulletPatch, Hit, OutlineFile } from '../types';
import { findBullet, insertBullet, moveBullet, removeBullet, updateBullet } from '../tree';
import { parseSegments, todayIso } from '../format';
import { BrowserReplica, permanentId, type HiveResponse, type ReplicaState } from './replica';
import { ApiError, request, setAccessToken } from './http';
import { operationBatch } from "./batch";
import { resolveConflict } from './conflicts';

export interface HiveStatus {
  enabled: boolean; role?: 'hub'|'client'; label?: string; name?: string; hiveId?: string; deviceId?: string;
  connected?: boolean; pending?: number; error?: string | null; address?: string;
  fileStatus?: Record<string,{path:string;error?:string;pending:boolean;written?:string}>;
  devices?: {id:string;label:string;revoked:boolean}[];
}
export interface HiveView {
  enabled:boolean; initialized:boolean; online:boolean; authRequired:boolean; syncing:boolean; saving?:number; drafts?:number;
  state?:ReplicaState; status?:HiveStatus; error?:string;
}
const replica = new BrowserReplica();
let view: HiveView = {enabled:false,initialized:false,online:false,authRequired:false,syncing:false};
const listeners = new Set<() => void>();
const drafts = new Set<string>();
function publish(patch: Partial<HiveView>) {view = {...view,...patch};for(const listener of listeners) listener();}
const subscribe = (fn:()=>void) => {listeners.add(fn);return () => {listeners.delete(fn);};};
export function useHive() { return useSyncExternalStore(subscribe, () => view); }
const publicFile = (file:SharedFile):OutlineFile => ({id:file.id,name:file.name,parentId:file.parentId,path:`hive:${file.id}`,bullets:structuredClone(file.bullets)});
function file(snapshot:HiveSnapshot,path:string) {
  if (!path.startsWith('hive:')) throw new ApiError(404,'This path is not a shared Outline File');
  const value=snapshot.files[path.slice(5)];if(!value)throw new ApiError(404,'Outline File not found');return value;
}
function locate(snapshot:HiveSnapshot,id:string) {
  for(const file of Object.values(snapshot.files)){const found=findBullet(file.bullets,id);if(found)return {file,...found};}
  throw new ApiError(404,'Bullet not found');
}
function parentExists(bullets:Bullet[],id:string|null) {
  if(id && !findBullet(bullets,id)) throw new Error('The destination parent no longer exists');
}
let initialization: Promise<boolean>|undefined;
let syncing:Promise<void>|undefined;
async function read() {const state=await replica.read();if(!state)throw new Error('Connect once to download this hive');return state;}
async function edit(change:(snapshot:HiveSnapshot)=>void,resolves?:string[]) {
  publish({saving:(view.saving??0)+1});
  try {const state=await replica.edit(change,resolves);publish({state,error:undefined});return state;}
  finally {publish({saving:Math.max(0,(view.saving??1)-1)});}
}
async function synchronize() {
  publish({syncing:true});
  try {
    const status=await request<HiveStatus>('GET','/api/hive/status');
    if(!status.enabled) {if(view.enabled) throw new Error('This server no longer has this hive enabled. Browser edits remain saved.');publish({status,initialized:true,online:true});return;}
    const state=await replica.read();
    // Check identity before ever transmitting operations to a replaced hive.
    if(state && status.hiveId !== state.hiveId) throw new Error('This address now serves a different hive. Export this browser’s saved work before switching.');
    // Verify history before handing any durable edits to this server.
    const history=state ? {cursor:String(state.cursor),generation:state.generation,hiveId:state.hiveId,...(state.checkpoint?{checkpoint:state.checkpoint}:{})} : undefined;
    const preflight=await request<HiveResponse>('GET',`/api/hive/snapshot${history?`?${new URLSearchParams(history)}`:''}`);
    const checked=await replica.accept(preflight);
    const operations=operationBatch(checked.outbox);
    const response=operations.length
      ? await request<HiveResponse>('POST','/api/hive/operations',{operations,history:{cursor:preflight.cursor,generation:preflight.generation,hiveId:preflight.hiveId,checkpoint:preflight.checkpoint}})
      : preflight;
    const saved=await replica.accept(response,operations.map(o=>o.id));
    const latest=await request<HiveStatus>('GET','/api/hive/status');
    publish({state:(await replica.read()) ?? saved,status:latest,enabled:true,initialized:true,online:true,authRequired:false,error:undefined});
  } catch(error) {
    publish({online:false,error:(error as Error).message,authRequired:error instanceof ApiError && error.status === 401 || view.authRequired});
    // Another tab may have committed while this tab was disconnected.
    const state=await replica.read().catch(()=>undefined);if(state)publish({state,enabled:true,initialized:true});
  } finally {publish({syncing:false});}
}
export const hive = {
  get active() {return view.enabled;},
  get view() {return view;},
  subscribe,
  draft(id:string,pending:boolean) {
    if(!view.enabled)return;
    if(pending)drafts.add(id);else drafts.delete(id);
    publish({drafts:drafts.size});
  },
  async initialize() {
    return initialization ??= (async()=>{
      const state=await replica.read();
      if(state) {publish({state,enabled:true,initialized:true});void hive.sync();return true;}
      const status=await request<HiveStatus>('GET','/api/hive/status');
      publish({status,enabled:status.enabled,online:true,initialized:true});
      if(status.enabled) {
        const state=await replica.accept(await request<HiveResponse>('GET','/api/hive/snapshot'));
        publish({state});
      }
      return status.enabled;
    })().catch(error=>{
      initialization=undefined;
      // Startup may finish before lifecycle event listeners attach or reattach.
      // Derive authentication state from the response as well as browser events.
      publish({initialized:true,online:false,authRequired:error instanceof ApiError && error.status===401 || view.authRequired});
      throw error;
    });
  },
  sync():Promise<void> {
    return syncing ??= (async()=>{
      if(navigator.locks) await navigator.locks.request('lister-hive-sync',synchronize);
      else await synchronize();
    })().finally(()=>{syncing=undefined;});
  },
  async refresh() {await hive.sync();if(!view.online)throw new Error(view.error ?? 'Could not connect');},
  start() {
    const timer=window.setInterval(()=>{if(view.enabled)void hive.sync();},1500);
    const online=()=>{void hive.sync();};const auth=()=>publish({authRequired:true});
    window.addEventListener('online',online);window.addEventListener('hive-auth-required',auth);
    return ()=>{clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('hive-auth-required',auth);};
  },
  async login(token:string) {
    await request('POST','/api/hive/session',{token});setAccessToken(token);publish({authRequired:false,error:undefined});initialization=undefined;await hive.initialize();await hive.refresh();
  },
  async setup(kind:'create'|'join',body:unknown) {await request('POST',`/api/hive/${kind}`,body);initialization=undefined;await hive.initialize();await hive.refresh();},
  async action<T>(name:string,body:unknown):Promise<T> {const value=await request<T>('POST',`/api/hive/${name}`,body);await hive.refresh();return value;},
  async ownerAction<T>(url:string,body?:unknown):Promise<T> {
    await hive.refresh();
    if((await read()).outbox.length)throw new Error('Wait for browser edits to reach the device before changing its files');
    const value=await request<T>('POST',url,body);await hive.refresh();return value;
  },
  async root() {await hive.initialize();const s=(await read()).snapshot;if(!s.rootFileId || !s.files[s.rootFileId])throw new Error('This hive has no root Outline File yet');return publicFile(s.files[s.rootFileId]);},
  async file(path:string) {return publicFile(file((await read()).snapshot,path));},
  async bullet(id:string) {const l=locate((await read()).snapshot,id);return {bullet:structuredClone(l.bullet),filePath:`hive:${l.file.id}`,fileName:l.file.name,parentId:l.parent?.id??null,index:l.index};},
  async add(path:string,parentId:string|null,index:number,text:string,id=permanentId()) {
    const bullet:Bullet={id,text:'',children:[]};
    // Keep style annotations verbatim while extracting supported metadata.
    const parts:string[]=[];
    for(const part of parseSegments(text)) {
      if(part.kind==='annotation' && part.kinds.length===1 && ['date','priority','done'].includes(part.kinds[0])) {
        const kind=part.kinds[0];if(kind==='date' && part.value)bullet.date=part.value;
        if(kind==='priority' && /^[123]$/.test(part.value??''))bullet.priority=Number(part.value) as 1|2|3;
        if(kind==='done')bullet.done=part.value??'';
      } else parts.push(part.kind==='text'?part.text:part.raw);
    }
    bullet.text=parts.join('').trim();
    await hive.restore(path,parentId,index,bullet);return bullet;
  },
  async restore(path:string,parentId:string|null,index:number,bullet:Bullet) {
    await edit(s=>{const f=file(s,path);parentExists(f.bullets,parentId);
      const check=(b:Bullet)=>{for(const f of Object.values(s.files))if(findBullet(f.bullets,b.id))throw new Error('This bullet already exists');b.children.forEach(check);};check(bullet);
      f.bullets=insertBullet(f.bullets,parentId,index,structuredClone(bullet));
    });return bullet;
  },
  async patch(id:string,patch:BulletPatch) {
    const state=await edit(s=>{const l=locate(s,id);l.file.bullets=updateBullet(l.file.bullets,id,patch as Partial<Bullet>);if(patch.text !== undefined && l.bullet.outline && s.files[l.bullet.outline]) s.files[l.bullet.outline].name=patch.text;});
    return structuredClone(locate(state.snapshot,id).bullet);
  },
  async move(id:string,path:string,parentId:string|null,index:number) {
    await edit(s=>{const l=locate(s,id),target=file(s,path);parentExists(target.bullets,parentId);
      if(parentId && (parentId===id || findBullet(l.bullet.children,parentId)))throw new Error('A bullet cannot move inside itself');
      if(target.id===l.file.id)target.bullets=moveBullet(target.bullets,id,parentId,index);
      else {l.file.bullets=removeBullet(l.file.bullets,id).bullets;target.bullets=insertBullet(target.bullets,parentId,index,l.bullet);}
      if(l.bullet.outline && s.files[l.bullet.outline])s.files[l.bullet.outline].parentId=parentId??target.id;
    });return {ok:true as const};
  },
  async remove(id:string) {
    let detached=false;await edit(s=>{const l=locate(s,id);detached=!!l.bullet.outline;l.file.bullets=removeBullet(l.file.bullets,id).bullets;});return {ok:true as const,detached};
  },
  async search(query:string) {
    const s=(await read()).snapshot,hits:Hit[]=[];const q=query.toLowerCase();
    for(const f of Object.values(s.files)) {
      const walk=(bullets:Bullet[],path:string[])=>{for(const b of bullets){if(`${b.text}\n${b.note??''}`.toLowerCase().includes(q))hits.push({id:b.id,text:b.text,filePath:`hive:${f.id}`,fileName:f.name,path,done:b.done,outline:b.outline});walk(b.children,[...path,b.text]);}};
      walk(f.bullets,[]);
    }return {hits};
  },
  async importOpml(xml:string,parentId?:string) {
    const document=new DOMParser().parseFromString(xml,'application/xml');
    if(document.querySelector('parsererror') || document.documentElement.tagName!=='opml')throw new Error('Not a valid OPML document');
    const body=document.documentElement.querySelector('body');if(!body)throw new Error('OPML body is missing');
    const convert=(element:Element):Bullet=>{
      const bullet:Bullet={id:permanentId(),text:(element.getAttribute('text')??'').trim(),children:[...element.children].filter(e=>e.tagName==='outline').map(convert)};
      const note=element.getAttribute('_note');if(note?.trim())bullet.note=note.replace(/\r\n/g,'\n').trim();
      if(element.getAttribute('_complete')==='true')bullet.done=todayIso();return bullet;
    };
    const bullets=[...body.children].filter(e=>e.tagName==='outline').map(convert);
    let filePath='';
    await edit(s=>{
      const loc=parentId?locate(s,parentId):null;
      const target=loc?.bullet.outline?s.files[loc.bullet.outline]:loc?.file ?? s.files[s.rootFileId!];
      if(!target)throw new Error('Import destination is missing');
      const parent=loc && !loc.bullet.outline?loc.bullet.id:null;
      for(const bullet of bullets)target.bullets=insertBullet(target.bullets,parent,Number.MAX_SAFE_INTEGER,bullet);
      filePath=`hive:${target.id}`;
    });
    return {imported:bullets.length,filePath};
  },
  async resolve(id:string,choice:'current'|'proposed') {
    await edit(s=>{const next=resolveConflict(s,id,choice);s.files=next.files;s.rootFileId=next.rootFileId;},[id]);
  },
  async export() {return JSON.stringify(await read(),null,2);},
};
