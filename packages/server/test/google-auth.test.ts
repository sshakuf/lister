import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HiveAgent } from '../src/hive/agent.js';
import { registerHiveRoutes } from '../src/hive/routes.js';

test('public Google configuration is available without a recovery token', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lister-google-'));
 const agent=new HiveAgent(path.join(dir,'hive')); const app=Fastify();
 registerHiveRoutes(app,agent,path.join(dir,'root.lister'),async()=>{});
 t.after(async()=>{await app.close();agent.close();fs.rmSync(dir,{recursive:true,force:true});});
 const response=await app.inject({url:'/api/hive/auth/config',headers:{host:'mini.example'}});
 assert.equal(response.statusCode,200); assert.deepEqual(response.json(),{google:false});
});

test('Google login verifies signed tokens, binds owner and persists revocable hive-scoped sessions', async t => {
 const {GoogleAuth,loadGoogleConfig}=await import('../src/auth/google.js');
 const {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet}=await import('jose');
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lister-google-'));
 const config={clientId:'client',clientSecret:'secret',ownerEmail:'sshakuf@gmail.com',origin:'https://mini.example'};
 assert.equal(loadGoogleConfig(dir),undefined);
 fs.writeFileSync(path.join(dir,'google-auth.json'),JSON.stringify(config),{mode:0o600});
 assert.deepEqual(loadGoogleConfig(dir),config);
 fs.chmodSync(path.join(dir,'google-auth.json'),0o644); assert.throws(()=>loadGoogleConfig(dir),/0600/);
 let now=Date.now(), claims:Record<string,unknown>={}, nonce='';
 const alternate=await generateKeyPair('RS256');let issuer='https://accounts.google.com',audience='client',expiry='5m',signingKey=privateKey;
 const exchange=async(_code:string,verifier:string)=>{assert.ok(verifier.length>=43);return new SignJWT({sub:'owner-sub',email:config.ownerEmail,email_verified:true,nonce,...claims}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(signingKey);};
 let auth=new GoogleAuth(dir,config,{keys,exchange,now:()=>now});
 t.after(()=>{auth.close();fs.rmSync(dir,{recursive:true,force:true});});
 const begin=()=>{const start=auth.start('hive1');const url=new URL(start.url);nonce=url.searchParams.get('nonce')!;assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'openid email');return {...start,state:url.searchParams.get('state')!};};
 const login=async()=>{const s=begin();return auth.finish(s.state,s.browser,'code','hive1','Test browser');};
 const start=begin();await assert.rejects(auth.finish(start.state,'wrong','code','hive1',''),/login/i);
 await assert.rejects(auth.finish(start.state,start.browser,'code','hive1',''),/login/i);
 for(const invalid of [{email:'other@gmail.com'},{email_verified:false},{nonce:'wrong'},{azp:'wrong-client'}]) {claims=invalid;await assert.rejects(login(),/login/i);}
 claims={};issuer='https://evil.example';await assert.rejects(login(),/login/i);issuer='https://accounts.google.com';
 audience='other-client';await assert.rejects(login(),/login/i);audience='client';
 expiry='-1s';await assert.rejects(login(),/login/i);expiry='5m';
 signingKey=alternate.privateKey;await assert.rejects(login(),/login/i);signingKey=privateKey;
 const session=await login();assert.ok(auth.authenticate(session.token,'hive1'));assert.equal(auth.authenticate(session.token,'other'),null);
 assert.equal(fs.readFileSync(path.join(dir,'browser-auth.sqlite')).includes(Buffer.from(session.token)),false);
 assert.throws(()=>new GoogleAuth(dir,{...config,ownerEmail:'changed@gmail.com'},{keys,exchange}),/local recovery/);
 auth.close();auth=new GoogleAuth(dir,config,{keys,exchange,now:()=>now});assert.ok(auth.authenticate(session.token,'hive1'));assert.equal(auth.sessions('hive1',session.token)[0].current,true);
 claims={sub:'different-sub'};await assert.rejects(login(),/login/i);claims={};
 auth.revoke(session.id,'hive1');assert.equal(auth.authenticate(session.token,'hive1'),null);
 const expiring=begin();now+=11*60000;await assert.rejects(auth.finish(expiring.state,expiring.browser,'code','hive1',''),/login/i);
 const last=await login();now+=31*86400000;assert.equal(auth.authenticate(last.token,'hive1'),null);
});

test('HTTP cookies require exact Origin, coexist with stale bearer, and logout revokes only this browser',async t=>{
 const {GoogleAuth}=await import('../src/auth/google.js');const {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT}=await import('jose');
 const {privateKey,publicKey}=await generateKeyPair('RS256');const keys=createLocalJWKSet({keys:[await exportJWK(publicKey)]});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lister-google-http-'));const root=path.join(dir,'root.lister');fs.writeFileSync(root,'# Root [id:root0001]\n');
 const config={clientId:'client',clientSecret:'secret',ownerEmail:'sshakuf@gmail.com',origin:'https://mini.example'};let nonce='';
 const auth=new GoogleAuth(dir,config,{keys,exchange:async()=>new SignJWT({sub:'owner',email:config.ownerEmail,email_verified:true,nonce}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience('client').setIssuedAt().setExpirationTime('5m').sign(privateKey)});
 const agent=new HiveAgent(path.join(dir,'hive'));agent.create('test','Mini',root);const app=Fastify();registerHiveRoutes(app,agent,root,async()=>{},undefined,auth);
 t.after(async()=>{await app.close();auth.close();agent.close();fs.rmSync(dir,{recursive:true,force:true});});
 app.get('/',async()=>({page:'Lister'}));
 for(const url of ['/', '/index.html']) {
  const old=await app.inject({url,headers:{host:'mini.example:7433'}});
  assert.equal(old.statusCode,302);
  assert.equal(old.headers.location,config.origin+'/');
 }
 assert.equal((await app.inject({url:'/',headers:{host:'mini.example'}})).statusCode,200);
 assert.equal((await app.inject({url:'/',headers:{host:'localhost'}})).statusCode,200);
 assert.equal((await app.inject({url:'/api/hive/status',headers:{host:'mini.example:7433'}})).statusCode,401);
 const headers={host:'mini.example'};
 const start=await app.inject({url:'/api/hive/auth/google/start?returnTo=https://evil.example',headers});const location=new URL(start.headers.location!);nonce=location.searchParams.get('nonce')!;
 const flowCookie=String(start.headers['set-cookie']).split(';')[0];
 const callback=await app.inject({url:'/api/hive/auth/google/callback?state='+location.searchParams.get('state')+'&code=secret-code',headers:{...headers,cookie:flowCookie}});
 assert.equal(callback.headers.location,config.origin+'/');
 const cookies=callback.headers['set-cookie'] as string[];const sessionCookie=cookies.find(c=>c.startsWith('__Host-lister_session='))!;assert.match(sessionCookie,/Secure; HttpOnly; SameSite=Lax/);
 const browser={...headers,cookie:sessionCookie.split(';')[0],authorization:'Bearer stale'};
 assert.equal((await app.inject({url:'/api/hive/status',headers:browser})).statusCode,200);
 for(const origin of [undefined,'https://evil.example','http://mini.example','null','garbage'])assert.equal((await app.inject({method:'POST',url:'/api/hive/sync',headers:{...browser,...(origin?{origin}:{})}})).statusCode,403);
 for(const origin of [undefined,'http://mini.example'])assert.equal((await app.inject({url:'/ws',headers:{...browser,...(origin?{origin}:{})}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/hive/sync',headers:{...browser,origin:config.origin}})).statusCode,200);
 const replay=await app.inject({url:'/api/hive/auth/google/callback?state='+location.searchParams.get('state')+'&code=secret-code',headers:{...headers,cookie:flowCookie}});assert.equal(replay.headers.location,config.origin+'/?login=failed');assert.doesNotMatch(replay.body,/secret-code/);
 assert.equal((await app.inject({method:'POST',url:'/api/hive/auth/logout',headers:{...browser,origin:config.origin}})).statusCode,200);
 assert.equal((await app.inject({url:'/api/hive/status',headers:browser})).statusCode,401);
 assert.equal((await app.inject({url:'/api/hive/status',headers:{...headers,authorization:'Bearer '+agent.sessionToken}})).statusCode,200);
 assert.equal((await app.inject({url:'/api/hive/status',headers:{host:'localhost'}})).statusCode,200);
});
