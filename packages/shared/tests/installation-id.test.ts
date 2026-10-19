/**
 * The installation ID (english repo spec 034-guest-ai-rollout): a random UUID
 * of its own, minted once per install, kept across updates and sign-outs, and
 * never the analytics identifier.
 */

const store: Record<string, unknown> = {};
let fetchMock: jest.Mock;
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

import { INSTALLATION_KEYS } from '../src/auth/storage';
import { ensureInstallation } from '../src/installation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    // The record is record.ts's subject; here it simply fails.
    fetchMock = jest.fn(async () => {
        throw new Error('offline');
    });
    (global as any).fetch = fetchMock;
});

test('the keys are the documented ones', () => {
    expect(INSTALLATION_KEYS).toEqual({ id: 'installation.id', fresh: 'installation.fresh', recorded: 'installation.recorded' });
});

test('a fresh install mints a lowercase UUID and remembers it was fresh, without touching the analytics id', async () => {
    store['analytics.clientId'] = 'analytics-id';
    const id = await ensureInstallation({ edition: 'youtube', fresh: true });
    expect(id).toMatch(UUID);
    expect(store['installation.id']).toBe(id);
    expect(store['installation.fresh']).toBe(true);
    expect(store['analytics.clientId']).toBe('analytics-id');
    expect(id).not.toBe('analytics-id');
});

test('a second call keeps the ID and the fresh flag it was minted with', async () => {
    const first = await ensureInstallation({ edition: 'rezka', fresh: true });
    const second = await ensureInstallation({ edition: 'rezka', fresh: false });
    expect(second).toBe(first);
    expect(store['installation.fresh']).toBe(true);
});

test('an update keeps an existing ID; one without an ID mints it as not fresh', async () => {
    store['installation.id'] = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
    expect(await ensureInstallation({ edition: 'youtube', fresh: false })).toBe('0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69');
    delete store['installation.id'];
    await ensureInstallation({ edition: 'youtube', fresh: false });
    expect(store['installation.id']).toMatch(UUID);
    expect(store['installation.fresh']).toBe(false);
});

test('calls at the same moment share one mint', async () => {
    const ids = await Promise.all([
        ensureInstallation({ edition: 'youtube', fresh: true }),
        ensureInstallation({ edition: 'youtube', fresh: false }),
        ensureInstallation({ edition: 'youtube', fresh: false }),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(store['installation.id']).toBe(ids[0]);
    expect(store['installation.fresh']).toBe(true);
});

test('unreadable storage mints nothing: an ID it cannot keep would be a new install every wake', async () => {
    const local = (global as any).chrome.storage.local;
    local.get.mockRejectedValueOnce(new Error('gone'));
    expect(await ensureInstallation({ edition: 'youtube', fresh: true })).toBeNull();
    expect(store['installation.id']).toBeUndefined();
});
