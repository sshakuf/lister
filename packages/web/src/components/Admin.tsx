import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AdminReport } from "../types";
import { useUi } from "../ui";
import { useStore } from "../store";

export function Admin() {
  const [report, setReport] = useState<AdminReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relinking, setRelinking] = useState<{ id: string; value: string } | null>(null);
  const [importParent, setImportParent] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const openPicker = useUi((s) => s.openPicker);
  const tick = useUi((s) => s.changeTick);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setReport(await api.adminFolders());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, tick]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
    // outline files may have changed under us
    const s = useStore.getState();
    for (const p of Object.keys(s.files)) s.refetch(p);
  };

  const onImport = async (file: File) => {
    const xml = await file.text();
    await run(async () => {
      const r = await api.importOpml(xml, importParent.trim() || undefined);
      setImportMsg(`Imported ${r.imported} top-level bullet(s) into ${r.filePath}`);
    });
  };

  return (
    <div className="admin">
      <h1>Admin</h1>
      {error && <div className="error-inline">{error}</div>}
      {!report && <div>Loading…</div>}
      {report && (
        <>
          <section>
            <h2>Folder Bullets ({report.folders.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Bullet</th>
                  <th>Folder</th>
                  <th>Outline File</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.folders.map((f) => (
                  <tr key={f.id} className={f.status}>
                    <td>{f.text || "(untitled)"}</td>
                    <td className="mono">{f.folder}</td>
                    <td className="mono">{f.filePath}</td>
                    <td>
                      <span className={`status ${f.status}`}>{f.status}</span>
                    </td>
                    <td className="actions">
                      <button
                        onClick={() =>
                          openPicker({
                            title: `Move "${f.text}" to folder`,
                            onPick: async (folder) => {
                              await api.adminMove(f.id, folder);
                              await load();
                            },
                          })
                        }
                      >
                        Move
                      </button>
                      {f.status === "broken" && (
                        <button onClick={() => setRelinking({ id: f.id, value: f.filePath })}>Relink</button>
                      )}
                      <button
                        className="danger"
                        onClick={() => {
                          if (confirm(`Move ${f.filePath} to trash and remove the Folder Bullet "${f.text}"?`)) run(() => api.adminTrash(f.filePath));
                        }}
                      >
                        Trash
                      </button>
                    </td>
                  </tr>
                ))}
                {report.folders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No Folder Bullets yet. In the outline press ⌘⇧Enter on a bullet to store it in a project folder.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {relinking && (
              <div className="relink">
                <label>
                  Path of the existing Outline File for this Folder Bullet:
                  <input className="mono" value={relinking.value} onChange={(e) => setRelinking({ ...relinking, value: e.target.value })} />
                </label>
                <button
                  className="primary"
                  onClick={() =>
                    run(async () => {
                      await api.adminRelink(relinking.id, relinking.value.trim());
                      setRelinking(null);
                    })
                  }
                >
                  Relink
                </button>
                <button onClick={() => setRelinking(null)}>Cancel</button>
              </div>
            )}
          </section>

          <section>
            <h2>Orphans ({report.orphans.length})</h2>
            <p className="muted">Outline Files on disk that no Folder Bullet references.</p>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>File</th>
                  <th>Recorded parent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.orphans.map((o) => (
                  <tr key={o.filePath}>
                    <td>{o.name}</td>
                    <td className="mono">{o.filePath}</td>
                    <td className="mono">{o.parentId ? `${o.parentId} ${o.parentExists ? "(exists)" : "(missing)"}` : "—"}</td>
                    <td className="actions">
                      <button className="primary" onClick={() => run(() => api.adminAdopt(o.filePath))} title={o.parentExists ? "Adopt under its recorded parent" : 'Adopt under "Recovered"'}>
                        Adopt
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (confirm(`Move ${o.filePath} to trash?`)) run(() => api.adminTrash(o.filePath));
                        }}
                      >
                        Trash
                      </button>
                    </td>
                  </tr>
                ))}
                {report.orphans.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      None.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Import OPML</h2>
            <p className="muted">Workflowy export. Notes and completion state are preserved. Imports under the root unless a parent Bullet ID is given.</p>
            <div className="import-row">
              <input className="mono" placeholder="Parent bullet id (optional)" value={importParent} onChange={(e) => setImportParent(e.target.value)} />
              <input ref={fileInput} type="file" accept=".opml,.xml,text/xml" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0]).then(() => { if (fileInput.current) fileInput.current.value = ""; })} />
            </div>
            {importMsg && <div className="ok-inline">{importMsg}</div>}
          </section>
        </>
      )}
    </div>
  );
}
