/**
 * The layers of the feature answer and the installation (english repo spec 034):
 * rules (pure) -> storage (chrome.storage only) -> network (injected fetch only)
 * -> worker (messages, lifecycle) -> views (read state, send messages).
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

const SRC = join(__dirname, '../src');
const ROOT = resolve(__dirname, '../../..');
const BARREL = join(SRC, 'index.ts');
/** The code of a source file, comments dropped so a comment naming chrome.* is no hit. */
const read = (rel: string) =>
    readFileSync(join(SRC, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
/** Imports that survive compilation, so type-only ones are skipped. */
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'";]*?\s*from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const CHROME_NOT_STORAGE = /\bchrome\.(?!storage\b)/;
const ANY_CHROME = /\bchrome\./;
const GLOBAL_FETCH = /(?<![.\w])fetch\s*\(/;
const valueImports = (src: string) => [...src.matchAll(IMPORT)].filter((m) => !m[1]).map((m) => m[2] ?? m[3]);

/** Value imports of file, the package barrel included, followed transitively. */
function reach(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (spec === '@video-transcripts/shared') reach(BARREL, seen);
        if (!spec.startsWith('.')) continue;
        const base = resolve(dirname(file), spec);
        const hit = [`${base}.ts`, join(base, 'index.ts')].find(existsSync);
        if (hit) reach(hit, seen);
    }
    return seen;
}

describe('rules', () => {
    test('features/rules.ts imports nothing and touches no chrome.*, fetch or DOM', () => {
        const src = read('features/rules.ts');
        expect([...src.matchAll(IMPORT)].map((m) => m[2] ?? m[3])).toEqual([]);
        expect(src).not.toMatch(ANY_CHROME);
        expect(src).not.toMatch(GLOBAL_FETCH);
        expect(src).not.toMatch(/\b(document|window)\./);
    });
});

describe('installation/: every file is one layer', () => {
    const LAYER: Record<string, 'storage' | 'network' | 'worker'> = {
        'store.ts': 'storage',
        'record.ts': 'network',
        'link.ts': 'network',
        'index.ts': 'worker',
    };

    test('no file is left unassigned', () => {
        expect(readdirSync(join(SRC, 'installation')).sort()).toEqual(Object.keys(LAYER).sort());
    });

    test.each(Object.entries(LAYER))('%s is %s', (file, layer) => {
        const src = read(`installation/${file}`);
        if (layer === 'storage') {
            expect(src).not.toMatch(GLOBAL_FETCH);
            expect(src).not.toMatch(/\bfetch\b/);
            expect(src).not.toMatch(CHROME_NOT_STORAGE);
        }
        if (layer === 'network') {
            expect(src).not.toMatch(ANY_CHROME);
            expect(src).not.toMatch(GLOBAL_FETCH);
            expect(valueImports(src)).toEqual([]);
        }
    });

    test.each(Object.entries(LAYER).filter(([, l]) => l !== 'worker'))('%s reaches nothing outside installation/ but the key leaf', (file) => {
        const outside = [...reach(join(SRC, 'installation', file))]
            .map((f) => f.slice(SRC.length + 1))
            .filter((f) => !f.startsWith('installation/') && f !== 'auth/keys.ts');
        expect(outside).toEqual([]);
    });

    test('only the workers import installation/; features/ never reaches it', () => {
        const importers = walk(SRC)
            .concat(['youtube', 'rezka'].flatMap((a) => walk(join(ROOT, 'apps', a, 'src'))))
            .filter((p) => !p.startsWith(join(SRC, 'installation')))
            .filter((p) => valueImports(readFileSync(p, 'utf8')).some((s) => /(^|\/)installation(\/|$)/.test(s)))
            .map((p) => p.slice(ROOT.length + 1))
            .sort();
        expect(importers).toEqual([
            'apps/rezka/src/background/background.ts',
            'apps/youtube/src/background/background.ts',
            'packages/shared/src/auth/background.ts',
        ]);
        for (const f of walk(join(SRC, 'features'))) {
            expect([...reach(f)].filter((r) => r.startsWith(join(SRC, 'installation')))).toEqual([]);
        }
    });
});

describe('storage and worker modules', () => {
    test.each(['features/store.ts', 'auth/state.ts'])('%s reads and writes chrome.storage, never fetches', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/\bfetch\b/);
        expect(src).not.toMatch(CHROME_NOT_STORAGE);
    });

    test('features/worker.ts reaches storage through ./store and the network through its deps', () => {
        const src = read('features/worker.ts');
        expect(src).not.toMatch(ANY_CHROME);
        expect(src).not.toMatch(GLOBAL_FETCH);
    });

    test('only the worker writes the feature answer', () => {
        const writers = walk(SRC)
            .filter((p) => p !== join(SRC, 'features/store.ts'))
            .filter((p) => /\b(keepAnswer|keepTried|markOff|forgetFeatures|accountGeneration)\b/.test(readFileSync(p, 'utf8')))
            .map((p) => p.slice(SRC.length + 1))
            .sort();
        expect(writers).toEqual(['auth/storage.ts', 'features/worker.ts']);
    });
});

describe('views', () => {
    // analytics-bg.ts and notifications.ts carry the GA4 secret; a page can read any bundle it loads.
    const WORKER_ONLY = ['installation/', 'features/worker.ts', 'auth/background.ts', 'settings-bridge.ts', 'analytics-bg.ts', 'notifications.ts'];
    const workerOnly = (files: Set<string>) =>
        [...files].filter((f) => f.startsWith(SRC)).map((f) => f.slice(SRC.length + 1)).filter((f) => WORKER_ONLY.some((w) => f.startsWith(w)));

    /** Every bundle a page or a tab loads: each vite entry but the background. */
    const entries = ['youtube', 'rezka'].flatMap((app) => {
        const cfg = readFileSync(join(ROOT, 'apps', app, 'vite.config.ts'), 'utf8');
        return [...cfg.matchAll(/resolve\(__dirname,\s*'(src\/[^']+\.ts)'\)/g)]
            .map((m) => m[1])
            .filter((p) => !p.startsWith('src/background/'))
            .map((p) => join('apps', app, p));
    });

    test('both apps name their view entries', () => {
        expect(entries.length).toBeGreaterThanOrEqual(14);
    });

    test.each(entries)('%s never reaches a worker-only module', (entry) => {
        expect(workerOnly(reach(join(ROOT, entry)))).toEqual([]);
    });

    test.each(['features/store.ts', 'features/follow.ts', 'ai-balance/badge.ts', 'ai-balance/signed-out.ts', 'index.ts'])(
        '%s never reaches a worker-only module',
        (file) => {
            expect(workerOnly(reach(join(SRC, file)))).toEqual([]);
        },
    );
});

function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });
}
