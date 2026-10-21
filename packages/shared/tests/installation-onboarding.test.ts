/**
 * When the installation is minted and recorded (english repo spec 034): at
 * install as fresh, at update as not fresh, and a worker start retries a record
 * that has not landed. None of it waits on the analytics switch.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const store: Record<string, unknown> = {};
let installed: ((d: { reason: string; previousVersion?: string }) => void)[] = [];
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

import { installInstallation } from '../src/installation';

const NO_DEPS = { ready: async () => undefined, signedIn: async () => null };

const reply = (status: number) => ({ ok: status >= 200 && status < 300, status }) as unknown as Response;
let fetchMock: jest.Mock;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    installed = [];
    fetchMock = jest.fn(async () => reply(204));
    (global as any).fetch = fetchMock;
});

test('an install mints a fresh installation and records it, with analytics switched off', async () => {
    store['prefs.v1'] = { analyticsEnabled: false };
    installInstallation('youtube', NO_DEPS);
    installed.forEach((fn) => fn({ reason: 'install' }));
    await settle();
    const id = store['installation.id'];
    expect(id).toEqual(expect.any(String));
    expect(bodies()).toEqual([{ id, edition: 'youtube', fresh: true }]);
    expect(store['installation.recorded']).toBe('https://api.test');
});

test('an update mints a not-fresh installation, and keeps one it already has', async () => {
    installInstallation('rezka', NO_DEPS);
    installed.forEach((fn) => fn({ reason: 'update', previousVersion: '1.0.26' }));
    await settle();
    expect(bodies()).toEqual([{ id: store['installation.id'], edition: 'rezka', fresh: false }]);
    const id = store['installation.id'];
    installed.forEach((fn) => fn({ reason: 'update', previousVersion: '1.0.27' }));
    await settle();
    expect(store['installation.id']).toBe(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a worker start records an installation whose record has not landed, as minted', async () => {
    store['installation.id'] = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
    store['installation.fresh'] = true;
    installInstallation('rezka', NO_DEPS);
    await settle();
    expect(bodies()).toEqual([{ id: '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69', edition: 'rezka', fresh: true }]);
    installInstallation('rezka', NO_DEPS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // recorded: nothing more
});

test('a worker start mints nothing: the install event right after it decides fresh', async () => {
    installInstallation('youtube', NO_DEPS);
    installed.forEach((fn) => fn({ reason: 'install' }));
    await settle();
    expect(bodies()).toEqual([{ id: store['installation.id'], edition: 'youtube', fresh: true }]);
});

test.each([
    ['youtube', 'apps/youtube/src/background/background.ts'],
    ['rezka', 'apps/rezka/src/background/background.ts'],
])('the %s worker starts its installation with its own edition, after the dev environment, with the signed-in caller', (edition, file) => {
    const src = readFileSync(join(__dirname, '../../..', file), 'utf8');
    const call = src.match(new RegExp(`installInstallation\\('${edition}', \\{[^}]*\\}\\)`))?.[0] ?? '';
    expect(call).toMatch(/\bready: devEnvReady\b/);
    expect(call).toMatch(/\bsignedIn: signedInCaller\b/);
});
