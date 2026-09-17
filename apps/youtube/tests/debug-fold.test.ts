import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The diagnostics recorder must fold out of production — and the SHAPE of the
 * guard is what decides whether it does.
 *
 * These read the source as text rather than executing it, because the fold
 * happens at build time and no runtime assertion can observe it. A jsdom test
 * with `__EXT_ENV__` stubbed to 'prod' proves the branch is not TAKEN; it says
 * nothing about whether the code is still in the bundle.
 *
 * Measured, not theorised: with the guard living only inside
 * `installTraceSink()`, a production page-script still carried 1.6KB of
 * unreachable event literals and header-formatting code, because terser could
 * not prove across the call boundary that the sink was always null. Hoisting
 * the test to a module-level `const DEBUG_BUILD` and gating each call site on
 * it took that to zero. That is the rule these tests pin.
 */

const SRC = join(__dirname, '..', 'src', 'content');
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8');

describe('the MAIN-world guard is one the minifier can fold', () => {
    const src = read('page-script.ts');

    test('the env test is hoisted to a module-level constant', () => {
        // A `const` initialised directly from the __EXT_ENV__ literal is what
        // becomes a literal `false` in a production build.
        expect(src).toMatch(/const DEBUG_BUILD = __EXT_ENV__ === 'dev';/);
    });

    test('every trace call site is gated on that constant, not only on the sink', () => {
        // `trace?.(...)` alone is a runtime null check terser keeps. Prefixed
        // with a provably-false constant, the whole expression is dead on its
        // face.
        const calls = src.split('\n').filter((l) => l.includes('trace?.({'));
        expect(calls.length).toBeGreaterThan(0);
        for (const line of calls) {
            expect(line).toContain('DEBUG_BUILD && trace?.({');
        }
    });

    test('the deps handed to the fetcher are gated too', () => {
        // These carry real function references. Ungated, they keep
        // pickHeaders/clipBody alive in the bundle whether or not a sink exists.
        for (const field of ['onEvent:', 'readHeaders:', 'clipText:']) {
            const line = src.split('\n').find((l) => l.trim().startsWith(field));
            expect(line).toBeDefined();
            expect(line).toContain('DEBUG_BUILD');
        }
    });
});

describe('the isolated-world entry point folds', () => {
    test('installDebugMode returns before touching anything in production', () => {
        const src = read('debug-mode.ts');
        // The guard must be the FIRST statement, so the rest of the function —
        // and every module it imports — is unreachable.
        const body = src.slice(src.indexOf('export function installDebugMode'));
        const firstStatement = body.split('\n').find((l) => l.trim().startsWith('if '));
        expect(firstStatement).toContain("__EXT_ENV__ !== 'dev'");
        expect(firstStatement).toContain('return');
    });

    test('the recorder binding is only ever assigned inside the guard', () => {
        const src = read('debug-mode.ts');
        // If anything outside installDebugMode assigned `recorder`, the
        // traceRecorder() call sites scattered through app-base could no longer
        // be proven inert.
        const assignments = src.split('\n').filter((l) => /^\s*recorder = /.test(l));
        expect(assignments).toHaveLength(1);
        const guardIdx = src.indexOf("__EXT_ENV__ !== 'dev'");
        expect(src.indexOf('recorder = rec')).toBeGreaterThan(guardIdx);
    });
});

describe('the pure trace module stays out of production by type-only imports', () => {
    test('timedtext-fetch imports debug-trace as a type, never as a value', () => {
        // timedtext-fetch is imported by page-script for real work, so ANY
        // value it pulls from debug-trace reaches the shipped MAIN-world
        // bundle. This is the exact leak that put the header allow-list into
        // production the first time.
        const src = read('timedtext-fetch.ts');
        const imports = src.split('\n').filter((l) => l.includes("from './debug-trace'"));
        expect(imports).toHaveLength(1);
        expect(imports[0]).toMatch(/^import type /);
    });

    test('debug-trace itself imports nothing that could pull it into a bundle', () => {
        // It must stay a leaf: pure, importable by both worlds, dragging
        // nothing behind it.
        const src = read('debug-trace.ts');
        const valueImports = src
            .split('\n')
            .filter((l) => /^import /.test(l) && !/^import type /.test(l));
        expect(valueImports).toEqual([]);
    });
});
