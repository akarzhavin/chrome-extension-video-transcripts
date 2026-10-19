// The link at sign-in (english repo spec 034): POST /dictionary/installations/link as the account.

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
import { installInstallation, linkAtSignIn } from '../src/installation';

const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
const reply = (status: number, body: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

beforeAll(() => installInstallation('youtube'));

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, { 'installation.id': ID, 'installation.recorded': true });
    config.apiBaseUrl = 'https://api.test/';
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

test('a failure is logged and answered false, never thrown, and not retried', async () => {
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
