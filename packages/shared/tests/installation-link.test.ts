// The link at sign-in (english repo spec 034): POST /dictionary/installations/link as the account;
// one that failed is kept and retried while signed in on that backend.

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { onInstalled: { addListener: jest.fn() }, OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' } },
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
import { installInstallation, linkAtSignIn, retryLink } from '../src/installation';

const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
const reply = (status: number, body: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

type Caller = Parameters<typeof linkAtSignIn>[0];
let caller: Caller | null = null;
const start = () => installInstallation('youtube', { ready: async () => undefined, signedIn: async () => caller });
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeAll(start);

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, { 'installation.id': ID, 'installation.recorded': 'https://api.test/' });
    config.apiBaseUrl = 'https://api.test/';
    caller = null;
    (global as any).fetch = jest.fn(); // the record: already landed, so never called
});

test('posts the ID and edition with the bearer token, and retries a 401 once with a fresh token', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, { joined: true }));
    const token = jest.fn(async (refresh: boolean) => ({ idToken: refresh ? 'fresh' : 'stale' }));
    expect(await linkAtSignIn({ fetch, token })).toBe(true);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.headers.Authorization, JSON.parse(init.body)])).toEqual([
        ['https://api.test/dictionary/installations/link', 'POST', 'Bearer stale', { id: ID, edition: 'youtube' }],
        ['https://api.test/dictionary/installations/link', 'POST', 'Bearer fresh', { id: ID, edition: 'youtube' }],
    ]);
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
});

test('a failure is logged and answered false, never thrown, and not retried on the spot', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
        for (const fetch of [
            jest.fn(async () => reply(500)),
            jest.fn(async () => {
                throw new Error('offline');
            }),
        ]) {
            expect(await linkAtSignIn({ fetch, token: async () => ({ idToken: 't' }) })).toBe(false);
            expect(fetch).toHaveBeenCalledTimes(1);
        }
        const noToken = async () => {
            throw new Error('signed out');
        };
        expect(await linkAtSignIn({ fetch: jest.fn(), token: noToken })).toBe(false);
        expect(warn).toHaveBeenCalled();
    } finally {
        warn.mockRestore();
    }
});

test('no ID (storage unreadable) or no API: nothing is sent', async () => {
    const fetch = jest.fn();
    const token = async () => ({ idToken: 't' });
    (global as any).chrome.storage.local.get.mockRejectedValueOnce(new Error('gone'));
    expect(await linkAtSignIn({ fetch, token })).toBe(false);
    config.apiBaseUrl = '';
    expect(await linkAtSignIn({ fetch, token })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
});

describe('a link that failed is retried', () => {
    const warn = jest.spyOn(console, 'warn');
    beforeEach(() => warn.mockImplementation(() => undefined));
    afterAll(() => warn.mockRestore());
    const ok = () => jest.fn(async () => reply(200, { joined: true }));
    const token = async () => ({ idToken: 't' });

    test('a failure keeps the backend it failed on; a success drops it', async () => {
        expect(await linkAtSignIn({ fetch: jest.fn(async () => reply(503)), token })).toBe(false);
        expect(store['installation.linkPending']).toBe('https://api.test/');
        expect(await linkAtSignIn({ fetch: ok(), token })).toBe(true);
        expect(store).not.toHaveProperty(['installation.linkPending']);
    });

    test('at the next signed-in features refresh, and only while one is pending', async () => {
        const fetch = ok();
        await retryLink({ fetch, token });
        expect(fetch).not.toHaveBeenCalled();
        store['installation.linkPending'] = 'https://api.test/';
        await retryLink({ fetch, token });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(store).not.toHaveProperty(['installation.linkPending']);
    });

    test('at a worker start while signed in; signed out it waits for the sign-in', async () => {
        store['installation.linkPending'] = 'https://api.test/';
        start();
        await settle();
        expect(store['installation.linkPending']).toBe('https://api.test/');
        const fetch = ok();
        caller = { fetch, token };
        start();
        await settle();
        expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://api.test/dictionary/installations/link']);
        expect(store).not.toHaveProperty(['installation.linkPending']);
    });

    test('never on another backend: a dev build switched away links there at its own sign-in', async () => {
        store['installation.linkPending'] = 'https://other.test';
        const fetch = ok();
        caller = { fetch, token };
        await retryLink({ fetch, token });
        start();
        await settle();
        expect(fetch).not.toHaveBeenCalled();
        expect(store['installation.linkPending']).toBe('https://other.test');
    });

    test('a refusal for good is not owed; a busy or failing server still is', async () => {
        expect(await linkAtSignIn({ fetch: jest.fn(async () => reply(400)), token })).toBe(false);
        expect(store).not.toHaveProperty(['installation.linkPending']);
        expect(await linkAtSignIn({ fetch: jest.fn(async () => reply(429)), token })).toBe(false);
        expect(store['installation.linkPending']).toBe('https://api.test/');
        store['installation.linkPending'] = 'https://api.test/';
        await retryLink({ fetch: jest.fn(async () => reply(403)), token });
        expect(store).not.toHaveProperty(['installation.linkPending']);
    });

    test('a retry that fails again stays pending and never throws', async () => {
        store['installation.linkPending'] = 'https://api.test/';
        await expect(retryLink({ fetch: jest.fn(async () => reply(500)), token })).resolves.toBeUndefined();
        expect(store['installation.linkPending']).toBe('https://api.test/');
    });
});
