import { applyHiveOperation, type HiveOperation, type HiveSnapshot } from '@lister/core/hive';

export interface HiveResponse {
  snapshot: HiveSnapshot;
  hiveId: string;
  deviceId: string;
  generation: string;
  cursor: number;
  checkpoint?: string;
  acks: Record<string, { ownerId: string; hash: string }>;
}
export interface ReplicaState extends HiveResponse {
  replicaId: string;
  outbox: HiveOperation[];
}

/** Eight permanent characters, without importing Node's crypto into the shell. */
export function permanentId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  while (id.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 252) id += alphabet[byte % 36];
      if (id.length === 8) break;
    }
  }
  return id;
}

/** One readwrite transaction serializes writers across tabs as well as callers. */
export class IndexedDbStorage {
  private database?: Promise<IDBDatabase>;
  constructor(public readonly name = 'lister-hive-v1') {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('replica');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async read(): Promise<ReplicaState | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('replica', 'readonly');
      const request = tx.objectStore('replica').get('current');
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  async update(change: (state: ReplicaState | undefined) => ReplicaState): Promise<ReplicaState> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('replica', 'readwrite');
      const store = tx.objectStore('replica');
      const request = store.get('current');
      let result: ReplicaState;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          result = change(request.result);
          store.put(result, 'current');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local save aborted'));
    });
  }
}

export class BrowserReplica {
  constructor(private storage = new IndexedDbStorage()) {}
  read() { return this.storage.read(); }
  async edit(change: (snapshot: HiveSnapshot) => void, resolves?: string[]): Promise<ReplicaState> {
    return this.storage.update(state => {
      if (!state) throw new Error('Connect to this hive once before editing offline');
      const base = structuredClone(state.snapshot), next = structuredClone(base);
      change(next);
      const operation: HiveOperation = { id: crypto.randomUUID(), replicaId: state.replicaId, base, next, ...(resolves ? {resolves} : {}) };
      const snapshot = applyHiveOperation(base, operation);
      return {...state, snapshot, outbox: [...state.outbox, operation]};
    });
  }
  async accept(response: HiveResponse, acknowledged: string[] = []): Promise<ReplicaState> {
    return this.storage.update(state => {
      if (state && response.hiveId !== state.hiveId) throw new Error('This address now serves a different hive. Export this browser’s saved work before switching.');
      if (state && (response.generation !== state.generation || response.cursor < state.cursor || (response.cursor === state.cursor && response.checkpoint && state.checkpoint && response.checkpoint !== state.checkpoint))) {
        throw new Error('Server history changed or moved to an older version. Browser work is preserved; export a backup before recovering the server.');
      }
      const accepted = new Set(acknowledged);
      const outbox = (state?.outbox ?? []).filter(op => !accepted.has(op.id));
      let snapshot = structuredClone(response.snapshot);
      for (const operation of outbox) snapshot = applyHiveOperation(snapshot, operation);
      return {...response, snapshot, replicaId: state?.replicaId ?? crypto.randomUUID(), outbox};
    });
  }
}
