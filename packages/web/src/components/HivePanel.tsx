import { request, logout, type BrowserSession } from '../hive/http';
import { useEffect, useState } from 'react';
import { hive, useHive } from '../hive/client';
import { api } from '../api';
import { useStore } from '../store';

export function HiveLogin() {
  const view=useHive();
  const [config,setConfig]=useState<{google:boolean;loginUrl?:string}>();
  useEffect(()=>{void request<{google:boolean;loginUrl?:string}>('GET','/api/hive/auth/config').then(setConfig).catch(()=>{});},[]);
  const [token,setToken]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  return <section className="hive-login" aria-labelledby="sign-in-title">
    <div className="login-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><circle cx="10" cy="11" r="2" fill="currentColor"/><circle cx="10" cy="20" r="2" fill="currentColor"/><circle cx="10" cy="29" r="2" fill="currentColor"/><path d="M18 11h12M18 20h9M18 29h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg></div>
    <p className="login-eyebrow">YOUR PERSONAL HIVE</p>
    <h2 id="sign-in-title">Welcome to Lister</h2>
    <p className="login-intro">Your lists, together.<br />Pick up where you left off, on any device.</p>
    {config?.google && <div className="login-action">{view.saving || view.drafts ? <p role="status">Saving your edits before sign-in…</p> : <a className="google-signin" href={config.loginUrl}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.86-3.55 6.08-8.78 6.08-14.82Z"/><path fill="#34A853" d="M24 44c5.5 0 10.11-1.82 13.48-4.94l-6.61-5.14c-1.83 1.23-4.17 1.97-6.87 1.97-5.3 0-9.8-3.58-11.41-8.4H5.76v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.59 27.49a12 12 0 0 1 0-6.98v-5.3H5.76a20 20 0 0 0 0 17.58l6.83-5.3Z"/><path fill="#EA4335" d="M24 12.11c3 0 5.68 1.03 7.8 3.05l5.85-5.86C34.1 5.99 29.5 4 24 4A20 20 0 0 0 5.76 15.21l6.83 5.3c1.61-4.82 6.11-8.4 11.41-8.4Z"/></svg>
      Continue with Google
    </a>}</div>}
    {new URLSearchParams(window.location.search).get('login')==='failed' && <p className="login-error" role="alert">Google sign-in failed. Use the owner account and try again.</p>}
    <div className="login-reassurance"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" stroke="currentColor" strokeWidth="1.5"/><path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><p>Your saved lists stay with you.<br /><span>Sign in online to sync your offline edits.</span></p></div>
    <details className="login-recovery" open={config?.google === false}><summary>Use a recovery token</summary>
    <p>For recovery, run <code>lister hive token</code> on the computer serving this page, then enter its access token.</p>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await hive.login(token.trim());await useStore.getState().init();setToken('');setError('');}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}>
      <label>Device access token <input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} required /></label>
      <button className="login-connect" disabled={busy || !token.trim()} type="submit">{busy?'Connecting…':'Connect'}</button>
    </form></details>
    {error && <p className="login-error" role="alert">{error}</p>}
  </section>;
}

export function HivePanel() {
  const view=useHive();
  const [name,setName]=useState('My hive');
  const [label,setLabel]=useState('');
  const [invitation,setInvitation]=useState('');
  const [address,setAddress]=useState('');
  const [path,setPath]=useState('');
  const [result,setResult]=useState('');
  const [ownerFile,setOwnerFile]=useState('');
  const [ownerPath,setOwnerPath]=useState('');
  const [importParent,setImportParent]=useState('');
  const [importResult,setImportResult]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const setup=async(kind:'create'|'join')=>{await hive.setup(kind,kind==='create'?{name,label}:{invitation,label});await useStore.getState().init();};
  const exportSaved=async()=>{const blob=new Blob([await hive.export()],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='lister-hive-browser-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const state=view.state,status=view.status;
  return <section className="hive-panel">
    <h2>Hive</h2>
    {error && <p className="error-inline">{error}</p>}
    {view.authRequired && <HiveLogin />}
    {!view.authRequired && <BrowserSessions />}
    {!view.enabled ? <>
      <p>Share one outline across computers. Each computer keeps ownership of its local Outline Files. This browser saves edits while offline.</p>
      <label>Computer label <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Laptop" /></label>
      <div className="hive-form"><label>Hive name <input value={name} onChange={e=>setName(e.target.value)} /></label><button disabled={busy || !name.trim() || !label.trim()} onClick={()=>run(()=>setup('create'))}>Create hive</button></div>
      <div className="hive-form"><label>Invitation <textarea value={invitation} onChange={e=>setInvitation(e.target.value)} placeholder="Paste the invitation from your hub" /></label><button disabled={busy || !invitation.trim() || !label.trim()} onClick={()=>run(()=>setup('join'))}>Join hive</button></div>
    </> : <>
      <p><strong>{status?.name || 'Shared outline'}</strong> · {status?.label || 'This device'} {status?.role ? `(${status.role})` : ''}</p>
      <dl className="hive-status">
        <dt>Browser save</dt><dd>{view.saving || view.drafts ? 'Saving…' : 'Saved on this browser'} · {state?.outbox.length ?? 0} operation(s) awaiting this computer</dd>
        <dt>Hub receipt</dt><dd>{!view.online ? 'Connection unavailable; edits stay on this browser' : state?.outbox.length ? 'Waiting for browser upload' : status?.pending ? `${status.pending} operation(s) waiting for hub` : status?.connected ? 'Hub has received this computer’s pending edits' : 'Hub disconnected'}</dd>
        <dt>Conflicts</dt><dd>{state?.snapshot.conflicts.length ?? 0} need review</dd>
      </dl>
      {(view.error || status?.error) && <p className="error-inline">{view.error || status?.error}</p>}
      <div className="hive-form"><button disabled={busy || view.syncing} onClick={()=>run(()=>hive.refresh())}>Sync now</button><button onClick={()=>run(exportSaved)}>Export browser backup</button></div>
      <h3>Owner files</h3>
      <p className="muted">Hub receipt and saving to an owner’s disk are separate. Only paths owned by this computer are shown.</p>
      <table><thead><tr><th>Outline</th><th>Owner</th><th>Disk status</th></tr></thead><tbody>
        {Object.values(state?.snapshot.files??{}).map(file=>{const local=status?.fileStatus?.[file.id],ack=state?.acks[file.id];return <tr key={file.id}><td>{file.name}</td><td>{file.ownerId===state?.deviceId?'This computer':file.ownerId.slice(0,8)}</td><td>{local ? local.error || (local.pending?'Waiting for disk write':'Saved to disk') : ack ? 'Owner has acknowledged a version' : 'Waiting for owner acknowledgment'}{local?.path && <div className="mono">{local.path}</div>}</td></tr>;})}
      </tbody></table>
      <div className="hive-form"><label>Register an Outline File on this computer <input className="mono" value={path} onChange={e=>setPath(e.target.value)} placeholder="/absolute/path/project.lister" /></label><button disabled={busy || !path.trim()} onClick={()=>run(async()=>{await hive.action('register',{filePath:path.trim()});setPath('');})}>Register file</button></div>
      {Object.values(state?.snapshot.files??{}).some(file=>file.ownerId===state?.deviceId && file.id!==state?.snapshot.rootFileId) && <details>
        <summary>Move or relink an owner file</summary>
        <label>Outline File <select value={ownerFile} onChange={e=>setOwnerFile(e.target.value)}><option value="">Select a file</option>{Object.values(state?.snapshot.files??{}).filter(file=>file.ownerId===state?.deviceId && file.id!==state?.snapshot.rootFileId).map(file=><option value={file.id} key={file.id}>{file.name}</option>)}</select></label>
        <label>Destination folder for Move, or existing file for Relink <input value={ownerPath} onChange={e=>setOwnerPath(e.target.value)} /></label>
        <div className="hive-form"><button disabled={busy || !ownerFile || !ownerPath.trim()} onClick={()=>run(async()=>{await api.adminMove(ownerFile,ownerPath.trim());setOwnerPath('');})}>Move folder</button><button disabled={busy || !ownerFile || !ownerPath.trim()} onClick={()=>run(async()=>{await api.adminRelink(ownerFile,ownerPath.trim());setOwnerPath('');})}>Relink file</button></div>
      </details>}
      <details><summary>Import OPML</summary>
        <p>Imports are saved on this browser and can be made offline. Notes and completion state are preserved.</p>
        <label>Parent bullet ID (optional) <input value={importParent} onChange={e=>setImportParent(e.target.value)} /></label>
        <label>OPML file <input type="file" accept=".opml,.xml,text/xml" disabled={busy} onChange={e=>{const input=e.currentTarget;const file=input.files?.[0];if(file)void run(async()=>{const result=await hive.importOpml(await file.text(),importParent.trim()||undefined);setImportResult(`Imported ${result.imported} top-level bullet(s)`);input.value='';});}} /></label>
        {importResult && <p>{importResult}</p>}
      </details>
      {status?.role==='hub' && <>
        <h3>Pair another computer</h3>
        <div className="hive-form"><label>Hub address reachable by the other computer <input type="url" value={address} onChange={e=>setAddress(e.target.value)} placeholder="https://your-hub.example" /></label><button disabled={busy || !address.trim()} onClick={()=>run(async()=>{const r=await hive.action<{invitation:string}>('invite',{address:address.trim()});setResult(r.invitation);})}>Create invitation</button></div>
        {result && <label>Single-use invitation <textarea readOnly value={result} onFocus={e=>e.target.select()} /></label>}
        {!!status.devices?.length && <ul>{status.devices.map(device=><li key={device.id}>{device.label} {device.revoked?'— revoked':<button disabled={busy} onClick={()=>run(async()=>{await hive.action('revoke',{deviceId:device.id});})}>Revoke access</button>}</li>)}</ul>}
      </>}
      {!!state?.snapshot.conflicts.length && <>
        <h3>Review conflicts</h3>
        <p>Choose the accepted value or recover the proposed value. Structural recovery preserves unrelated edits. Export the backup to retain every candidate for manual recovery.</p>
        {state.snapshot.conflicts.map(conflict=><article className="hive-conflict" key={conflict.id}>
          <strong>{conflict.bulletId} · {conflict.field}</strong>
          <details><summary>Compare candidates</summary><p>Base</p><pre>{JSON.stringify(conflict.base,null,2)}</pre><p>Accepted</p><pre>{JSON.stringify(conflict.current,null,2)}</pre><p>Proposed</p><pre>{JSON.stringify(conflict.proposed,null,2)}</pre>{conflict.context && <details><summary>Full structural context</summary><pre>{JSON.stringify(conflict.context,null,2)}</pre></details>}</details>
          <div className="hive-form"><button disabled={busy} onClick={()=>run(()=>hive.resolve(conflict.id,'current'))}>Keep accepted</button><button disabled={busy} onClick={()=>run(()=>hive.resolve(conflict.id,'proposed'))}>Recover proposed</button></div>
        </article>)}
      </>}
    </>}
  </section>;
}

function BrowserSessions() {
  const [sessions,setSessions]=useState<BrowserSession[]>([]);
  const [google,setGoogle]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=async()=>{const result=await request<{sessions:BrowserSession[]}>('GET','/api/hive/auth/sessions');setSessions(result.sessions);};
  useEffect(()=>{void request<{google:boolean}>('GET','/api/hive/auth/config').then(async config=>{setGoogle(config.google);if(config.google)await refresh();}).catch(()=>{});},[]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  if(!google)return null;
  return <details><summary>Browser sign-in sessions</summary>
    <p>Signing out or revoking a browser keeps its downloaded lists and pending edits. This does not erase data from that browser.</p>
    {error && <p className="error-inline">{error}</p>}
    <button disabled={busy} onClick={()=>run(refresh)}>Refresh sessions</button>
    <ul>{sessions.map(session=><li key={session.id}>{session.current?'This browser':session.label || 'Browser'} · expires {new Date(session.expires).toLocaleDateString()} <button disabled={busy} onClick={()=>run(async()=>{if(session.current){await logout();await hive.sync();}else{await request('POST',`/api/hive/auth/sessions/${session.id}/revoke`);await refresh();}})}>Revoke</button></li>)}</ul>
    <button disabled={busy} onClick={()=>run(async()=>{await logout();await hive.sync();})}>Sign out of this browser</button>
  </details>;
}
