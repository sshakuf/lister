import { Command } from 'commander';
import path from 'node:path';
import { findServer } from './remote.js';
export function installHiveCommands(program: Command) {
    const hive = program.command('hive').description('Create or join a hive and synchronize this computer’s Outline Files');
    const call = async (method: string, endpoint: string, body?: unknown) => {
        const base = await findServer();
        if (!base)
            throw new Error('Start this computer’s server first: lister serve --daemon');
        const response = await fetch(base + '/api/hive/' + endpoint, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json() as any;
        if (!response.ok)
            throw new Error(data.error ?? `HTTP ${response.status}`);
        return data;
    };
    const run = (fn: (...args: any[]) => Promise<unknown>) => async (...args: any[]) => { try {
        const result = await fn(...args);
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
    } };
    hive.command('create <name>').requiredOption('--label <label>', 'name of this computer').action(run((name, opts) => call('POST', 'create', { name, label: opts.label })));
    hive.command('join <invitation>').requiredOption('--label <label>', 'name of this computer').action(run((invitation, opts) => call('POST', 'join', { invitation, label: opts.label })));
    hive.command('invite <address>').description('Create a single-use invitation (expires in 10 minutes)').action(run(async (address) => (await call('POST', 'invite', { address })).invitation));
    hive.command('register <file>').description('Share an existing local Outline File and its reachable local Folder Bullets').action(run(file => call('POST', 'register', { filePath: path.resolve(file) })));
    hive.command('status').action(run(() => call('GET', 'status')));
    hive.command('sync').action(run(() => call('POST', 'sync', {})));
    hive.command('token').description('Show this device’s browser access token; treat it as a password').action(run(async () => (await call('GET', 'access')).token));
    hive.command('revoke <device-id>').action(run(deviceId => call('POST', 'revoke', { deviceId })));
    hive.command('export').description('Export shared data and pending edits as JSON (without credentials)').action(run(() => call('GET', 'export')));
}
