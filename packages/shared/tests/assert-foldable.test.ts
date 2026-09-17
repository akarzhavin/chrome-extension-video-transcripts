import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The release gate's marker list, read out of its source.
 *
 * Not `import`ed: assert-shippable.mjs is ESM and jest transforms this suite as
 * CJS, so a real import fails to parse. Reading the literal keeps the two files
 * coupled — which is the point of the drift checks below — without dragging a
 * module-format problem into a test about release safety.
 */
const DEBUG_TRACE_MARKERS: string[] = (() => {
    const src = readFileSync(join(__dirname, '..', 'assert-shippable.mjs'), 'utf8');
    const block = src.match(/export const DEBUG_TRACE_MARKERS = \[([\s\S]*?)\];/);
    if (!block) throw new Error('DEBUG_TRACE_MARKERS not found in assert-shippable.mjs');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

/**
 * The pre-build gate: can the dev-only recorder still fold away?
 *
 * It answers a question the output gate structurally cannot. That one matches
 * strings in a finished bundle, so a guard rewritten to a weaker shape — one
 * that still drops the classes but leaves unnamed event literals behind —
 * passes it while shipping readable dead code. Measured on this codebase at
 * 1.6KB in a production page-script.
 *
 * Every test here works by BREAKING a real source file in a copy of the repo
 * and asserting the gate notices. A gate tested only against a healthy tree is
 * a gate whose failure path has never run.
 */

const REPO = join(__dirname, '..', '..', '..');
const GATE = join(REPO, 'packages', 'shared', 'assert-foldable.mjs');

const dirs: string[] = [];

/** A minimal repo copy: only the files the gate reads. */
function makeTree(): string {
    const dir = mkdtempSync(join(tmpdir(), 'foldable-'));
    dirs.push(dir);
    for (const rel of [
        'apps/youtube/src/content/page-script.ts',
        'apps/youtube/src/content/timedtext-fetch.ts',
        'apps/youtube/src/content/debug-mode.ts',
        'apps/youtube/src/content/debug-bridge.ts',
        'apps/youtube/src/content/debug-recorder.ts',
        'apps/youtube/src/content/debug-ui.ts',
        'packages/shared/src/SidebarUI.ts',
    ]) {
        const dest = join(dir, rel);
        mkdirSync(join(dest, '..'), { recursive: true });
        cpSync(join(REPO, rel), dest);
    }
    return dir;
}

function edit(dir: string, rel: string, fn: (src: string) => string): void {
    const full = join(dir, rel);
    writeFileSync(full, fn(readFileSync(full, 'utf8')));
}

function runGate(dir: string): { code: number; output: string } {
    const r = spawnSync('node', [GATE, dir], { encoding: 'utf8' });
    return { code: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('the healthy tree', () => {
    it('passes against the real repository', () => {
        // Not a copy: the actual source, so the gate and the code cannot drift
        // apart without this failing.
        const { code, output } = runGate(REPO);
        expect(output).toBe('');
        expect(code).toBe(0);
    });
});

describe('the MAIN-world guard', () => {
    it('refuses a trace call site missing the DEBUG_BUILD prefix', () => {
        // The regression that actually happened: terser drops the classes but
        // keeps `trace?.({…})`, because it cannot prove across a call boundary
        // that the sink is always null.
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/page-script.ts', (s) =>
            s.replace('DEBUG_BUILD && trace?.({', 'trace?.({'),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/without the DEBUG_BUILD prefix/);
        // It names the line, so the fix does not need a bundle safari.
        expect(output).toMatch(/line \d+:/);
    });

    it('refuses a tree with no module-level DEBUG_BUILD constant', () => {
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/page-script.ts', (s) =>
            s.replace("const DEBUG_BUILD = __EXT_ENV__ === 'dev';", 'const DEBUG_BUILD = isDevBuild();'),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/no module-level/);
    });
});

describe('the type-only import discipline', () => {
    it('refuses a value import of debug-trace from timedtext-fetch', () => {
        // timedtext-fetch is imported by page-script for real work, so any
        // value it pulls from debug-trace ships to production.
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/timedtext-fetch.ts', (s) =>
            s.replace(
                "import type { FetchTraceEvent } from './debug-trace';",
                "import { clipBody, type FetchTraceEvent } from './debug-trace';",
            ),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/imports debug-trace as a VALUE/);
    });
});

describe('the isolated-world entry point', () => {
    it('refuses a guard that is not the first statement', () => {
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/debug-mode.ts', (s) =>
            s.replace(
                "export function installDebugMode(app: BaseVttApp): void {\n    if (__EXT_ENV__ !== 'dev') return;",
                'export function installDebugMode(app: BaseVttApp): void {\n    if (!app) return;\n' +
                    "    if (__EXT_ENV__ !== 'dev') return;",
            ),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/does not open with/);
    });

    it('refuses more than one assignment to the recorder binding', () => {
        // A second assignment outside the guard would mean the
        // traceRecorder()?.record(…) call sites scattered through app-base are
        // no longer provably inert in production.
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/debug-mode.ts', (s) =>
            s.replace('    recorder = rec;', '    recorder = rec;\n    recorder = rec;'),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/assigns `recorder` 2 times/);
    });
});

describe('drift between the source and the release gate', () => {
    // The quiet death of every string-matching gate: the code is renamed, the
    // rule keeps matching a string that can no longer appear, and the gate goes
    // on reporting success about nothing.
    it('refuses a marker the release gate does not know about', () => {
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/debug-bridge.ts', (s) =>
            s.replace(
                "export const DEBUG_HELLO = 'LG_TRACE_HELLO';",
                "export const DEBUG_HELLO = 'LG_TRACE_HELLO';\nexport const DEBUG_PING = 'LG_TRACE_PING';",
            ),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/does not know about: LG_TRACE_PING/);
    });

    it('refuses a DOM name the release gate does not know about', () => {
        // The same drift, in the family where it actually happened. Every test
        // above exercises `LG_TRACE_*`, and the scanner had a separate,
        // narrower branch for the DOM names: `vtt-trace-row` written exact,
        // with no wildcard. It therefore could not see `vtt-trace-rows` — the
        // container id the actions grew when they moved into one row — nor any
        // other new name in the family. The gate whose whole job is to notice
        // an unregistered name was blind to a real one for as long as it
        // existed, and said nothing, which is what these gates are for.
        const dir = makeTree();
        edit(dir, 'packages/shared/src/SidebarUI.ts', (s) =>
            s.replace("traceRows.id = 'vtt-trace-rows';", "traceRows.id = 'vtt-trace-cluster';"),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/does not know about: vtt-trace-cluster/);
    });

    it('refuses a marker the source no longer uses', () => {
        const dir = makeTree();
        edit(dir, 'apps/youtube/src/content/debug-bridge.ts', (s) =>
            s.replace(/'LG_TRACE_BATCH'/g, "'LG_TRACE_BULK'"),
        );

        const { code, output } = runGate(dir);

        expect(code).toBe(1);
        expect(output).toMatch(/no longer uses: LG_TRACE_BATCH/);
    });
});

describe('the marker list itself', () => {
    it('covers every name the recorder uses, in both worlds', () => {
        // Pinned so a shortened list is a deliberate edit. The first version of
        // the release rule matched two of these six; the other four — two wire
        // messages and both DOM ids — went through a release gate unchallenged.
        expect([...DEBUG_TRACE_MARKERS].sort()).toEqual([
            'LG_TRACE_BATCH',
            'LG_TRACE_HELLO',
            'LG_TRACE_STATE',
            'debug.trace.v1',
            'vtt-debug-toggle',
            'vtt-trace-row',
            'vtt-trace-rows',
        ]);
    });

    it('is importable without running the gate', () => {
        // assert-shippable is a CLI. An early `process.exit(0)` guard for the
        // import case terminates the IMPORTER — which made this gate exit 0
        // having run none of its own checks, the most dangerous shape of green.
        expect(DEBUG_TRACE_MARKERS.length).toBeGreaterThan(0);
    });
});
