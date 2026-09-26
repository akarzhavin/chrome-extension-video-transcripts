#!/usr/bin/env node
/**
 * Refuse to START a release build whose SOURCE cannot fold away.
 *
 * The other gate (assert-shippable.mjs) inspects the build output and is the
 * one that decides shippability. This one runs before the build and answers a
 * different question: not "did the feature end up in the artifact" but "is the
 * code still written in the one shape that keeps it out".
 *
 * Why both, when the output check is the authoritative one:
 *
 *   - An output check can only find what it knows to look for. It matches a
 *     list of strings, and a refactor that renames one makes the gate quietly
 *     report on nothing. This check reads the recorder's own source and fails
 *     when it grows a marker the output gate's list does not carry — so the two
 *     cannot drift apart silently, which is the failure mode of every
 *     string-matching gate.
 *
 *   - A guard rewritten from `DEBUG_BUILD && trace?.(…)` to a plain
 *     `trace?.(…)` still folds MOSTLY. Measured on this codebase: the classes
 *     went, and 1.6KB of event literals and header-formatting code stayed in a
 *     production page-script. The output gate's markers happened to catch that
 *     one; a subtler regression leaving only unnamed literals would produce a
 *     bundle that is bigger, readable, and passes every string match.
 *
 *   - Failing before the build is worth something on its own: the feedback
 *     names the line to fix rather than a minified artifact to go spelunking in.
 *
 * Exit codes: 0 foldable, 1 a problem, 2 misuse.
 *
 * Usage: node assert-foldable.mjs [repo-root]
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEBUG_TRACE_MARKERS } from './assert-shippable.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2] ?? join(here, '..', '..');
const CONTENT = join(repo, 'apps/youtube/src/content');

const read = (rel) => {
    const full = join(repo, rel);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

const findings = [];
const fail = (why) => findings.push(why);

// ── 1. The MAIN-world guard must be one the minifier can fold ───────────────
//
// `installTraceSink()` returning null is NOT enough on its own: terser drops
// the classes but will not prove across a call boundary that the returned sink
// is always null, so every `trace?.({…})` survives with its object literal.
// Only a module-level constant initialised straight from the __EXT_ENV__
// literal folds the call sites too.
{
    const src = read('apps/youtube/src/content/page-script.ts');
    if (!src) {
        fail('apps/youtube/src/content/page-script.ts is missing — cannot verify the fold');
    } else {
        if (!/const DEBUG_BUILD = __EXT_ENV__ === 'dev';/.test(src)) {
            fail(
                'page-script.ts has no module-level `const DEBUG_BUILD = __EXT_ENV__ === \'dev\'`\n' +
                '      A guard inside the installer folds the classes and leaves the call\n' +
                '      sites: measured at 1.6KB of dead event literals in a prod bundle.',
            );
        }
        const ungated = src
            .split('\n')
            .map((line, i) => [i + 1, line])
            .filter(([, line]) => line.includes('trace?.({') && !line.includes('DEBUG_BUILD &&'));
        if (ungated.length) {
            fail(
                'page-script.ts calls the trace sink without the DEBUG_BUILD prefix:\n' +
                ungated.map(([n, l]) => `      line ${n}: ${l.trim().slice(0, 70)}`).join('\n') +
                '\n      Write `DEBUG_BUILD && trace?.({…})` so the whole expression is dead\n' +
                '      on its face in a production build.',
            );
        }
    }
}

// ── 2. timedtext-fetch must import the trace module for TYPES only ──────────
//
// page-script imports timedtext-fetch for real work, so anything it pulls from
// debug-trace as a VALUE reaches the shipped MAIN-world bundle whether a sink
// exists or not. This is the exact leak that put the header allow-list into
// production once already.
{
    const src = read('apps/youtube/src/content/timedtext-fetch.ts');
    if (!src) {
        fail('apps/youtube/src/content/timedtext-fetch.ts is missing');
    } else {
        const imports = src.split('\n').filter((l) => l.includes("from './debug-trace'"));
        const valueImports = imports.filter((l) => !/^\s*import type /.test(l));
        if (valueImports.length) {
            fail(
                'timedtext-fetch.ts imports debug-trace as a VALUE:\n' +
                valueImports.map((l) => `      ${l.trim()}`).join('\n') +
                '\n      It is imported by page-script for real work, so this ships to\n' +
                '      production. Use `import type`, and inject any helpers with the sink.',
            );
        }
    }
}

// ── 3. The isolated-world entry point must bail before doing anything ───────
{
    const src = read('apps/youtube/src/content/debug-mode.ts');
    if (!src) {
        fail('apps/youtube/src/content/debug-mode.ts is missing');
    } else {
        const body = src.slice(src.indexOf('export function installDebugMode'));
        const firstIf = body.split('\n').find((l) => l.trim().startsWith('if '));
        if (!firstIf || !firstIf.includes("__EXT_ENV__ !== 'dev'") || !firstIf.includes('return')) {
            fail(
                "installDebugMode() does not open with `if (__EXT_ENV__ !== 'dev') return;`\n" +
                '      Everything the recorder imports is reachable from this function, so\n' +
                '      the guard has to be its first statement or none of it folds.',
            );
        }
        // The recorder binding is what makes every traceRecorder()?.record(…)
        // call site inert across app-base and index. Assigned anywhere outside
        // the guard, that inference is gone.
        const assignments = src.split('\n').filter((l) => /^\s*recorder = /.test(l));
        if (assignments.length !== 1) {
            fail(
                `debug-mode.ts assigns \`recorder\` ${assignments.length} times; expected exactly 1\n` +
                '      More than one assignment means a call site outside the guard could set\n' +
                '      it, and every traceRecorder()?.record(…) elsewhere stops being provably\n' +
                '      inert in a production build.',
            );
        }
    }
}

// ── 4. The marker list must still describe the feature ──────────────────────
//
// The output gate matches strings. A refactor that renames one leaves that gate
// reporting on nothing, with no failure anywhere — the quiet death every
// string-matching check dies. So the source is scanned for the same shapes and
// anything new must be added to the list deliberately.
{
    const files = [
        'apps/youtube/src/content/debug-bridge.ts',
        'apps/youtube/src/content/debug-recorder.ts',
        'apps/youtube/src/content/debug-ui.ts',
        'packages/shared/src/SidebarUI.ts',
        'packages/shared/src/debug/save-log.ts',
        'packages/shared/src/debug/save-diag-worker.ts',
    ];
    const found = new Set();
    for (const rel of files) {
        const src = read(rel);
        if (!src) continue;
        // The shapes the feature's names take: the wire protocol, and the DOM
        // names — `vtt-debug-*` for the recorder's own ids, `vtt-trace-*` for
        // the settings row its actions live on. Deliberately narrow: a broad
        // pattern would sweep up unrelated identifiers and make this cry wolf.
        //
        // The boundary is a quote OR a space, not a quote alone. A CSS class is
        // written inside a class list — `'vtt-panel-row vtt-trace-row'` — so a
        // quote-anchored pattern silently sees nothing there, which is this
        // gate's own failure mode rather than a finding.
        //
        // `vtt-trace-*` carries a wildcard, like `vtt-debug-*` beside it. It
        // once did not: a `vtt-trace-row--danger` modifier would have been
        // reported as a second unknown marker, so the entry was written exact.
        // That modifier is gone, and the exact form then missed the very thing
        // this gate exists to catch — the actions moved into one row and grew
        // a container id, `vtt-trace-rows`, which the pattern could not see
        // because of the trailing `s`. A gate that reads a sample of the
        // feature and reports on the sample is the failure mode being guarded
        // against here, so the pattern matches the family, not one member.
        for (const m of src.matchAll(
            /['"`\s](LG_TRACE[A-Z_]*|vtt-debug-[a-z-]+|vtt-trace-[a-z-]+|debug\.[a-z]+\.v\d+|__lingogram[A-Za-z]+)['"`\s]/g,
        )) {
            found.add(m[1]);
        }
    }
    const unknown = [...found].filter((name) => !DEBUG_TRACE_MARKERS.includes(name));
    if (unknown.length) {
        fail(
            `the recorder carries names the release gate does not know about: ${unknown.join(', ')}\n` +
            '      Add them to DEBUG_TRACE_MARKERS in assert-shippable.mjs, or that gate\n' +
            '      is matching a sample of the feature and reporting on the sample.',
        );
    }
    // The reverse is a problem too: a marker that no longer exists in the
    // source is a rule matching a string that can never appear again, which
    // reads as coverage and is not.
    const stale = DEBUG_TRACE_MARKERS.filter((name) => !found.has(name));
    if (stale.length) {
        fail(
            `DEBUG_TRACE_MARKERS lists names the source no longer uses: ${stale.join(', ')}\n` +
            '      A rule matching a string that cannot appear looks like coverage and is\n' +
            '      not. Remove them, or restore the code that used them.',
        );
    }
}

// ── 4. Word-save diagnostics fold with the same shape ───────────────────────
//
// The save log's call sites live in three shared modules that production runs
// for real work (the worker's save handler, the Firestore client, the content
// script's saveTerm). Each must hold the module-level constant, and every call
// into the diagnostics must be gated on it — `diag?.x()` alone is a runtime
// check the minifier keeps, along with the module it calls into.
{
    const sites = [
        'packages/shared/src/auth/background.ts',
        'packages/shared/src/auth/firestoreRest.ts',
        'packages/shared/src/content/quick-add-overlay.ts',
    ];
    const CALL = /\b(diag\.[a-zA-Z]+\(|noteSave\(|attachDiag\(|createWorkerDiag\(|diagOf\()/;
    for (const rel of sites) {
        const src = read(rel);
        if (!src) {
            fail(`${rel} is missing — the save-diagnostics fold check has nothing to read`);
            continue;
        }
        if (!/^const DIAG_BUILD = __EXT_ENV__ === 'dev';$/m.test(src)) {
            fail(`${rel}: no module-level \`const DIAG_BUILD = __EXT_ENV__ === 'dev';\``);
        }
        src.split('\n').forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '');
            if (!CALL.test(code)) return;
            if (/^\s*(function|async function|export)/.test(code)) return; // a definition
            if (code.includes('DIAG_BUILD')) return;
            fail(`${rel}:${i + 1}: save-diagnostics call not gated on DIAG_BUILD\n        ${line.trim()}`);
        });
    }
}

if (!findings.length) {
    process.exit(0);
}

console.error('');
console.error('  REFUSING TO BUILD — the dev-only recorder would not fold away');
console.error('');
for (const f of findings) console.error(`    • ${f}`);
console.error('');
console.error('  These are SOURCE problems: fix them before building, rather than');
console.error('  discovering them in a minified bundle. Background:');
console.error('  packages/shared/docs/dev-flags.md');
console.error('');
process.exit(1);
