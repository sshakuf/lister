import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, loadConfig, saveConfig } from '@lister/server';
const exec=promisify(execFile);

test('CLI creates hive, registers local file and edits a remote-reference branch',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'hive-cli-'));
 const cfg=loadConfig(home);cfg.port=0;saveConfig(cfg);
 const server=await startServer({home,webDist:'/nonexistent'});
 t.after(async()=>{await server.close();fs.rmSync(home,{recursive:true,force:true});});
 const main=path.resolve('src/main.ts');
 const run=async(...args:string[])=>(await exec(process.execPath,['--import','tsx',main,...args],{env:{...process.env,HOME:home},cwd:process.cwd()})).stdout;
 const created=JSON.parse(await run('hive','create','CLI Hive','--label','Test owner'));assert.equal(created.role,'hub');
 const local=path.join(home,'projects.lister');fs.writeFileSync(local,'# Projects [id:project0]\n- Existing [id:existing]\n');
 await run('hive','register',local);
 assert.match(await run('list','--all'),/Projects/);
 await run('add','Added through folder reference','--under','project0');
 assert.match(await run('list','--all'),/Added through folder reference/);
 const exported=await run('hive','export');assert.match(exported,/CLI|Projects/);assert.doesNotMatch(exported,/sessionToken|credential/);
});
