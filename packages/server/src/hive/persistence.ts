import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/** One durable transaction contains projection, receipts, outbox and write intents. */
export class JsonDatabase<T> {
    private db: DatabaseSync;
    private closed = false;
    constructor(dir: string) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, 'hive.sqlite');
        this.db = new DatabaseSync(file);
        fs.chmodSync(file, 0o600);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    }
    read(): T | null { const row = this.db.prepare('SELECT value FROM state WHERE id=1').get() as {
        value: string;
    } | undefined; return row ? JSON.parse(row.value) : null; }
    write(value: T) { this.db.exec('BEGIN IMMEDIATE'); try {
        this.db.prepare('INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(value));
        this.db.exec('COMMIT');
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    close() { if (!this.closed) {
        this.closed = true;
        this.db.close();
    } }
}
