import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleConfig { clientId: string; clientSecret: string; ownerEmail: string; origin: string }
const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
export const SESSION_COOKIE = '__Host-lister_session';
export const FLOW_COOKIE = '__Host-lister_login';
export function cookie(name: string, value: string, age: number) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`; }
export function readCookie(header: string | undefined, name: string) { const matches=(header ?? '').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'=')); return matches.length===1 ? matches[0].slice(name.length+1) : ''; }
export function loadGoogleConfig(dir: string): GoogleConfig | undefined {
 const file=path.join(dir,'google-auth.json');
 if(!fs.existsSync(file))return;
 try {
  const stat=fs.lstatSync(file);
  if(!stat.isFile() || (stat.mode & 0o777)!==0o600)throw new Error();
 }catch {throw new Error('Google auth configuration must be a regular mode-0600 file');}
 try {
  const c=JSON.parse(fs.readFileSync(file,'utf8')) as GoogleConfig;
  if(![c.clientId,c.clientSecret,c.ownerEmail,c.origin].every(v=>typeof v==='string' && v.trim()===v && v.length>0))throw new Error();
  const u=new URL(c.origin);
  if(u.protocol!=='https:' || u.origin!==c.origin || !/^[^@\s]+@[^@\s]+$/.test(c.ownerEmail))throw new Error();
  return {...c,ownerEmail:c.ownerEmail.toLowerCase()};
 }catch {throw new Error('Invalid Google auth configuration');}
}
interface Flow { browserHash:string; verifier:string; nonce:string; expires:number; hive:string }
interface Session { id:string; tokenHash:string; subject:string; hive:string; created:number; expires:number; label:string }
export class GoogleAuth {
 private db: DatabaseSync;
 private flows=new Map<string,Flow>();
 private keys:JWTVerifyGetKey;
 private now:()=>number;
 private exchange:(code:string,verifier:string)=>Promise<string>;
 readonly callback: string;
 constructor(dir:string,readonly config:GoogleConfig,options:{keys?:JWTVerifyGetKey;now?:()=>number;exchange?:(code:string,verifier:string)=>Promise<string>}={}) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'browser-auth.sqlite');
  this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);
  this.db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, subject TEXT); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, tokenHash TEXT UNIQUE NOT NULL, subject TEXT NOT NULL, hive TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, label TEXT NOT NULL)');
  const fingerprint=hash(JSON.stringify([config.clientId,config.ownerEmail.toLowerCase(),config.origin]));
  this.db.prepare('INSERT OR IGNORE INTO binding(id,config) VALUES(1,?)').run(fingerprint);
  const binding=this.db.prepare('SELECT config FROM binding WHERE id=1').get() as {config:string};
  if(binding.config!==fingerprint){this.db.close();throw new Error('Google owner/client/origin changed; local recovery must reset browser-auth.sqlite before enabling Google login');}
  this.keys=options.keys??createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  this.now=options.now??Date.now;this.callback=config.origin+'/api/hive/auth/google/callback';
  this.exchange=options.exchange??(async(code,verifier)=>{
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:this.callback}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('Google login failed');
   const result=await response.json() as {id_token?:string};if(typeof result.id_token!=='string')throw new Error('Google login failed');return result.id_token;
  });
 }
 start(hive:string) {
  for(const [key,flow] of this.flows)if(flow.expires<=this.now())this.flows.delete(key);
  if(this.flows.size>=1000)throw new Error('Google login unavailable');
  const state=secret(),browser=secret(),verifier=secret(),nonce=secret();
  this.flows.set(hash(state),{browserHash:hash(browser),verifier,nonce,expires:this.now()+10*60000,hive});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.callback,response_type:'code',scope:'openid email',state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.href,browser};
 }
 async finish(state:string,browser:string,code:string,hive:string,label:string) {
  const flow=this.flows.get(hash(state));this.flows.delete(hash(state));
  try {
   if(!flow || !browser || flow.browserHash!==hash(browser) || flow.expires<=this.now() || flow.hive!==hive || !code)throw new Error();
   const token=await this.exchange(code,flow.verifier);
   const {payload}=await jwtVerify(token,this.keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:this.config.clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce','email','email_verified']});
   if(payload.nonce!==flow.nonce || payload.email_verified!==true || typeof payload.email!=='string' || payload.email.toLowerCase()!==this.config.ownerEmail.toLowerCase() || typeof payload.sub!=='string' || !payload.sub || (payload.azp!==undefined && payload.azp!==this.config.clientId))throw new Error();
   this.db.exec('BEGIN IMMEDIATE');
   try {
    const binding=this.db.prepare('SELECT subject FROM binding WHERE id=1').get() as {subject:string|null};
    if(binding.subject && binding.subject!==payload.sub)throw new Error();
    this.db.prepare('UPDATE binding SET subject=? WHERE id=1').run(payload.sub);
    const token=secret(),id=randomUUID(),now=this.now();
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(id,hash(token),payload.sub,hive,now,now+30*86400000,label.slice(0,200));
    this.db.exec('COMMIT');return {id,token};
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }catch {throw new Error('Google login failed');}
 }
 authenticate(token:string,hive:string):Session|null {
  if(!token)return null;
  return (this.db.prepare('SELECT s.* FROM sessions s JOIN binding b ON b.subject=s.subject WHERE s.tokenHash=? AND s.hive=? AND s.expires>?').get(hash(token),hive,this.now()) as unknown as Session)??null;
 }
 sessions(hive:string,token:string) {return (this.db.prepare('SELECT id,created,expires,label,tokenHash FROM sessions WHERE hive=? AND expires>? ORDER BY created DESC').all(hive,this.now()) as unknown as Session[]).map(({id,created,expires,label,tokenHash})=>({id,created,expires,label,current:!!token && hash(token)===tokenHash}));}
 revoke(id:string,hive:string){this.db.prepare('DELETE FROM sessions WHERE id=? AND hive=?').run(id,hive);}
 logout(token:string,hive:string){const session=this.authenticate(token,hive);if(session)this.revoke(session.id,hive);}
 close(){this.db.close();}
}
