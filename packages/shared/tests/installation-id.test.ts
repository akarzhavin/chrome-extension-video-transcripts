/**
 * The installation ID (english repo spec 034-guest-ai-rollout): a random UUID
 * of its own, minted once per install, kept across updates and sign-outs, and
 * never the analytics identifier.
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

import { INSTALLATION_KEYS } from '../src/auth/storage';
import { guestCheck, installInstallation } from '../src/installation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const local = (global as any).chrome.storage.local;
const fired = (reason: 'install' | 'update') => installed.forEach((fn) => fn({ reason }));
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
    for (const k of Object.keys(store)) delete store[k];
    installed = [];
    // The record is record's subject; here it simply fails.
    (global as any).fetch = jest.fn(async () => {
        throw new Error('offline');
    });
    installInstallation('youtube', { ready: async () => undefined, signedIn: async () => null });
    await settle();
    local.set.mockClear();
});

test('the keys are the documented ones', () => {
    expect(INSTALLATION_KEYS).toEqual({
        id: 'installation.id',
        fresh: 'installation.fresh',
        recorded: 'installation.recorded',
        recordedDay: 'installation.recordedDay',
        linkPending: 'installation.linkPending',
    });
});

test('a fresh install mints a lowercase UUID and remembers it was fresh, without touching the analytics id', async () => {
    store['analytics.clientId'] = 'analytics-id';
    fired('install');
    await settle();
    expect(store['installation.id']).toMatch(UUID);
    expect(store['installation.fresh']).toBe(true);
    expect(store['analytics.clientId']).toBe('analytics-id');
});

test('a later update keeps the ID and the fresh flag it was minted with', async () => {
    fired('install');
    await settle();
    const first = store['installation.id'];
    fired('update');
    await settle();
    expect(store['installation.id']).toBe(first);
    expect(store['installation.fresh']).toBe(true);
});

test('an update keeps an existing ID; one without an ID mints it as not fresh', async () => {
    store['installation.id'] = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
    fired('update');
    await settle();
    expect(store['installation.id']).toBe('0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69');
    delete store['installation.id'];
    fired('update');
    await settle();
    expect(store['installation.id']).toMatch(UUID);
    expect(store['installation.fresh']).toBe(false);
});

test('a guest check mints a missing ID as not fresh', async () => {
    await guestCheck();
    expect(store['installation.id']).toMatch(UUID);
    expect(store['installation.fresh']).toBe(false);
});

test('mints at the same moment share one', async () => {
    fired('install');
    fired('update');
    void guestCheck();
    await settle();
    const mints = local.set.mock.calls.filter(([o]: [Record<string, unknown>]) => INSTALLATION_KEYS.id in o);
    expect(mints).toHaveLength(1);
    expect(store['installation.fresh']).toBe(true);
});

test('unreadable storage mints nothing: an ID it cannot keep would be a new install every wake', async () => {
    local.get.mockRejectedValueOnce(new Error('gone'));
    fired('install');
    await settle();
    expect(store['installation.id']).toBeUndefined();
});
