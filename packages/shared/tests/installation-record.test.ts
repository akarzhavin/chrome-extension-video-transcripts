/**
 * Recording the installation with the server (english repo spec 034): once per
 * backend, without a token, with the fresh flag known at mint; retried until it lands.
 */

const store: Record<string, unknown> = {};
let installed: ((d: { reason: string }) => void)[] = [];
(global as any).chrome = {
    runtime: {
        onInstalled: { addListener: (fn: (d: { reason: string }) => void) => installed.push(fn) },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    },
    storage: {
        local: {
            get: jest.fn(async (k: string | string[]) => {
                const out: Record<string, unknown> = {};
                for (const key of Array.isArray(k) ? k : [k]) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (o: Record<string, unknown>) => {
                Object.assign(store, o);
            }),
            remove: jest.fn(async (k: string | string[]) => {
                for (const key of Array.isArray(k) ? k : [k]) delete store[key];
            }),
        },
    },
};

import { config } from '../src/auth/config';
import { installInstallation } from '../src/installation';

const RECORD = 'https://api.test/dictionary/installations';
const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }) as unknown as Response;
let fetchMock: jest.Mock;
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url, init, body: JSON.parse((init as RequestInit).body as string) }));
const fired = (reason: 'install' | 'update') => installed.forEach((fn) => fn({ reason }));
const storedId = () => store['installation.id'];
let ready: () => Promise<void>;
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}
/** A worker (re)start of the given edition. */
async function start(edition: 'youtube' | 'rezka'): Promise<void> {
    installed = [];
    installInstallation(edition, { ready: () => ready(), signedIn: async () => null });
    await settle();
}

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    fetchMock = jest.fn(async () => reply(204));
    (global as any).fetch = fetchMock;
    config.apiBaseUrl = 'https://api.test';
    ready = async () => undefined;
});

test('records once, with the ID, the edition and fresh, and no token', async () => {
    await start('rezka');
    fired('install');
    await settle();
    const id = storedId();
    expect(sent()).toEqual([{ url: RECORD, init: expect.objectContaining({ method: 'POST' }), body: { id, edition: 'rezka', fresh: true } }]);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Content-Type']).toBe('application/json');
    expect(store['installation.recorded']).toBe('https://api.test');
    expect(store).not.toHaveProperty(['installation.fresh']);
    fired('update');
    await start('rezka');
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a failed record is retried at the next worker start, still as the fresh install it was', async () => {
    fetchMock.mockImplementationOnce(async () => {
        throw new Error('offline');
    });
    fetchMock.mockImplementationOnce(async () => reply(429));
    await start('youtube');
    fired('install');
    await settle();
    const id = storedId();
    expect(store['installation.recorded']).toBeUndefined();
    expect(store['installation.fresh']).toBe(true);
    await start('youtube');
    expect(store['installation.recorded']).toBeUndefined();
    await start('youtube');
    expect(sent().map((s) => s.body)).toEqual([
        { id, edition: 'youtube', fresh: true },
        { id, edition: 'youtube', fresh: true },
        { id, edition: 'youtube', fresh: true },
    ]);
    expect(store['installation.recorded']).toBe('https://api.test');
});

test('an update is recorded as not fresh', async () => {
    await start('youtube');
    fired('update');
    await settle();
    expect(sent()[0].body.fresh).toBe(false);
});

test('mints at the same moment send one record', async () => {
    await start('youtube');
    fired('install');
    fired('update');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('without an API base URL nothing is sent, and the ID is still kept', async () => {
    config.apiBaseUrl = '';
    await start('youtube');
    fired('install');
    await settle();
    expect(storedId()).toEqual(expect.any(String));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store['installation.fresh']).toBe(true);
});

test('waits for a dev build to restore its backend before it reads the API base URL', async () => {
    store['installation.id'] = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
    let restore: () => void = () => undefined;
    const restored = new Promise<void>((r) => (restore = r));
    ready = () => restored;
    config.apiBaseUrl = 'https://home.test';
    await start('youtube');
    expect(fetchMock).not.toHaveBeenCalled();
    config.apiBaseUrl = 'https://api.test';
    restore();
    await settle();
    expect(sent().map((s) => s.url)).toEqual([RECORD]);
    expect(store['installation.recorded']).toBe('https://api.test');
});

test('the record is kept per backend: a switched dev target records again there, a store build once', async () => {
    store['installation.id'] = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
    await start('youtube');
    await start('youtube');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    config.apiBaseUrl = 'https://other.test';
    await start('youtube');
    expect(sent().map((s) => s.url)).toEqual([RECORD, 'https://other.test/dictionary/installations']);
    expect(store['installation.recorded']).toBe('https://other.test');
});

test('a record kept by an earlier build as `true` names no backend: it is recorded once more, as an update', async () => {
    Object.assign(store, { 'installation.id': '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69', 'installation.recorded': true });
    await start('rezka');
    await start('rezka');
    expect(sent().map((s) => s.body)).toEqual([{ id: '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69', edition: 'rezka', fresh: false }]);
    expect(store['installation.recorded']).toBe('https://api.test');
});
