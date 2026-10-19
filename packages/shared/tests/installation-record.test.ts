/**
 * Recording the installation with the server (english repo spec 034): once,
 * without a token, with the fresh flag known at mint; retried until it lands.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
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
import { ensureInstallation } from '../src/installation';

const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }) as unknown as Response;
let fetchMock: jest.Mock;
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url, init, body: JSON.parse((init as RequestInit).body as string) }));

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    fetchMock = jest.fn(async () => reply(204));
    (global as any).fetch = fetchMock;
    config.apiBaseUrl = 'https://api.test';
});

test('records once, with the ID, the edition and fresh, and no token', async () => {
    const id = await ensureInstallation({ edition: 'rezka', fresh: true });
    expect(sent()).toEqual([
        {
            url: 'https://api.test/dictionary/installations',
            init: expect.objectContaining({ method: 'POST' }),
            body: { id, edition: 'rezka', fresh: true },
        },
    ]);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Content-Type']).toBe('application/json');
    expect(store['installation.recorded']).toBe(true);
    expect(store).not.toHaveProperty('installation.fresh');
    await ensureInstallation({ edition: 'rezka', fresh: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a failed record is retried on the next call, still as the fresh install it was', async () => {
    fetchMock.mockImplementationOnce(async () => {
        throw new Error('offline');
    });
    fetchMock.mockImplementationOnce(async () => reply(429));
    const id = await ensureInstallation({ edition: 'youtube', fresh: true });
    expect(store['installation.recorded']).toBeUndefined();
    expect(store['installation.fresh']).toBe(true);
    await ensureInstallation({ edition: 'youtube', fresh: false });
    expect(store['installation.recorded']).toBeUndefined();
    await ensureInstallation({ edition: 'youtube', fresh: false });
    expect(sent().map((s) => s.body)).toEqual([
        { id, edition: 'youtube', fresh: true },
        { id, edition: 'youtube', fresh: true },
        { id, edition: 'youtube', fresh: true },
    ]);
    expect(store['installation.recorded']).toBe(true);
});

test('an update is recorded as not fresh', async () => {
    await ensureInstallation({ edition: 'youtube', fresh: false });
    expect(sent()[0].body.fresh).toBe(false);
});

test('calls at the same moment send one record', async () => {
    await Promise.all([
        ensureInstallation({ edition: 'youtube', fresh: true }),
        ensureInstallation({ edition: 'youtube', fresh: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('without an API base URL nothing is sent, and the ID is still kept', async () => {
    config.apiBaseUrl = '';
    try {
        expect(await ensureInstallation({ edition: 'youtube', fresh: true })).toEqual(expect.any(String));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(store['installation.fresh']).toBe(true);
    } finally {
        config.apiBaseUrl = 'https://api.test';
    }
});
