/** @jest-environment node */
// The link at sign-in (english repo spec 034): POST /dictionary/installations/link as the account.

import { linkInstallation } from '../src/installation/link';

const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
const reply = (status: number, body: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

test('posts the ID and edition with the bearer token, and retries a 401 once with a fresh token', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, { joined: true }));
    const token = jest.fn(async (refresh: boolean) => ({ idToken: refresh ? 'fresh' : 'stale' }));
    expect(await linkInstallation('https://api.test/', 'youtube', { fetch, token, id: async () => ID })).toBe(true);
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
            expect(await linkInstallation('https://api.test', 'rezka', { fetch, token: async () => ({ idToken: 't' }), id: async () => ID })).toBe(false);
            expect(fetch).toHaveBeenCalledTimes(1);
        }
        const noToken = async () => {
            throw new Error('signed out');
        };
        expect(await linkInstallation('https://api.test', 'rezka', { fetch: jest.fn(), token: noToken, id: async () => ID })).toBe(false);
        expect(warn).toHaveBeenCalled();
    } finally {
        warn.mockRestore();
    }
});

test('no ID or no API: nothing is sent', async () => {
    const fetch = jest.fn();
    const token = async () => ({ idToken: 't' });
    expect(await linkInstallation('https://api.test', 'rezka', { fetch, token, id: async () => null })).toBe(false);
    expect(await linkInstallation('', 'rezka', { fetch, token, id: async () => ID })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
});
