/**
 * The installation ID and the analytics ID never meet (english repo spec 034,
 * FR-001/FR-004): no analytics hit carries the installation ID, no installation
 * request carries the analytics ID, and neither module reaches the other.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

const SRC = join(__dirname, '../src');
const ROOT = resolve(__dirname, '../../..');
const INSTALLATION_ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
const CLIENT_ID = '5d0c8a3e-77aa-4f1e-9b0c-2e4d6f8a1b3c';

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const area = (store: Record<string, unknown>) => ({
    get: jest.fn(async (k: string | string[] | null) => {
        if (k === null) return { ...store };
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
});
let installed: ((d: { reason: string }) => void)[] = [];
const uninstallUrls: string[] = [];
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.27' }),
        onInstalled: { addListener: (fn: (d: { reason: string }) => void) => installed.push(fn) },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
        setUninstallURL: (u: string) => uninstallUrls.push(u),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    tabs: { create: jest.fn(async () => ({ id: 1 })) },
    storage: { local: area(local), session: area(session) },
};

import { markInstalled, onboardingClientId, track } from '../src/analytics-bg';
import { installOnboarding } from '../src/onboarding';
import { installInstallation } from '../src/installation';

/** Relative imports of file, resolved to source paths, followed transitively. */
function reach(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
        const base = resolve(dirname(file), spec);
        const hit = [`${base}.ts`, join(base, 'index.ts')].find(existsSync);
        if (hit) reach(hit, seen);
    }
    return seen;
}
const rel = (files: Set<string>) => [...files].map((f) => f.slice(SRC.length + 1));
const installationFiles = readdirSync(join(SRC, 'installation')).map((f) => join(SRC, 'installation', f));
const analyticsFiles = readdirSync(SRC).filter((f) => /^analytics.*\.ts$/.test(f)).map((f) => join(SRC, f));

describe('imports', () => {
    test.each(analyticsFiles.map((f) => [f.slice(SRC.length + 1), f]))('%s never reaches installation/', (_name, file) => {
        expect(rel(reach(file)).filter((f) => f.startsWith('installation/'))).toEqual([]);
    });

    test.each(installationFiles.map((f) => [f.slice(SRC.length + 1), f]))('%s never reaches analytics', (_name, file) => {
        expect(rel(reach(file)).filter((f) => f.startsWith('analytics'))).toEqual([]);
    });

    test('code and tests outside installation/ enter it only through its index', () => {
        const outside: string[] = [];
        for (const p of filesOutsideInstallation()) {
            for (const [, spec] of readFileSync(p, 'utf8').matchAll(/from\s+['"](\.[^'"]*installation[^'"]*)['"]/g)) {
                if (resolve(dirname(p), spec) !== join(SRC, 'installation')) outside.push(`${p.slice(ROOT.length + 1)} -> ${spec}`);
            }
        }
        expect(outside).toEqual([]);
    });

    test('only installation/ touches its storage keys; auth/storage.ts lists them', () => {
        const touching = filesOutsideInstallation()
            .filter((p) => p.startsWith(SRC) && p !== join(SRC, 'auth/storage.ts'))
            .filter((p) => /INSTALLATION_KEYS|['"]installation\.(id|fresh|recorded)['"]/.test(readFileSync(p, 'utf8')));
        expect(touching.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
    });
});

/** Every .ts under the shared package and both apps, src and tests, but installation/ itself. */
function filesOutsideInstallation(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) {
                if (p !== join(SRC, 'installation')) walk(p);
            } else if (p.endsWith('.ts')) out.push(p);
        }
    };
    for (const dir of [SRC, __dirname, ...['youtube', 'rezka'].flatMap((a) => ['src', 'tests'].map((d) => join(ROOT, 'apps', a, d)))]) walk(dir);
    return out;
}

describe('payloads', () => {
    let fetchMock: jest.Mock;
    const everythingSent = () =>
        fetchMock.mock.calls.map(([url, init]) => `${url} ${JSON.stringify(init?.headers ?? {})} ${init?.body ?? ''}`).join('\n');

    beforeEach(() => {
        for (const k of Object.keys(local)) delete local[k];
        for (const k of Object.keys(session)) delete session[k];
        installed = [];
        uninstallUrls.length = 0;
        fetchMock = jest.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
        (global as any).fetch = fetchMock;
        Object.assign(local, { 'analytics.clientId': CLIENT_ID });
    });

    test('an install with both modules sends neither ID where the other goes', async () => {
        installInstallation('youtube');
        installOnboarding('youtube', {
            clientId: onboardingClientId,
            onInstall: () => {
                void markInstalled();
                void track('extension_installed');
            },
        });
        installed.forEach((fn) => fn({ reason: 'install' }));
        for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
        const installationId = String(local['installation.id']);
        expect(installationId).toMatch(/^[0-9a-f-]{36}$/);

        const hits = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://ga4.test'));
        const records = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.test'));
        expect(hits.length).toBeGreaterThan(0);
        expect(records.length).toBe(1);
        for (const [url, init] of hits) expect(`${url} ${init.body}`).not.toContain(installationId);
        for (const [url, init] of records) expect(`${url} ${init.body}`).not.toContain(CLIENT_ID);
        const tabs = ((global as any).chrome.tabs.create as jest.Mock).mock.calls.map(([o]) => o.url);
        for (const u of [...tabs, ...uninstallUrls]) expect(u).not.toContain(installationId);
    });

    test('a later hit carries no installation ID either', async () => {
        local['installation.id'] = INSTALLATION_ID;
        await track('word_saved', { site: 'youtube' });
        expect(fetchMock).toHaveBeenCalled();
        expect(everythingSent()).not.toContain(INSTALLATION_ID);
    });
});
