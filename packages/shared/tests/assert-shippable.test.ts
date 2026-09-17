/**
 * The release gate, tested against synthetic build directories.
 *
 * Covered here because the gate is the only thing standing between a broken
 * build and the Web Store, and until now nothing checked IT. A typo in one
 * regex silently downgrades it from "refuses bad builds" to "approves
 * everything", which looks identical from the outside: a green build either
 * way. The analytics rule especially — it exists because two mute releases
 * (youtube 1.0.15 and 1.0.16) passed the gate and shipped.
 *
 * Runs the real script as a subprocess rather than importing it: the script's
 * contract IS its exit code, and it calls process.exit() at module scope.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


const GATE = join(__dirname, '..', 'assert-shippable.mjs');

const PROD_ID = 'G-09BWM1R5S5';
const DEV_ID = 'G-V0MLJ7ZFNC';

/** A background bundle that passes every rule. */
function healthyBackground(): string {
    return [
        'const cfg = { projectId: "lingogram-prod" };',
        `fetch("https://www.google-analytics.com/mp/collect?measurement_id=${PROD_ID}&api_secret=s3cret");`,
    ].join('\n');
}

/** A manifest that passes every rule. */
function healthyManifest(): Record<string, unknown> {
    return {
        manifest_version: 3,
        version: '1.0.17',
        externally_connectable: { matches: ['https://lingogram.ai/*'] },
        host_permissions: [
            'https://identitytoolkit.googleapis.com/*',
            'https://securetoken.googleapis.com/*',
            'https://firestore.googleapis.com/*',
            'https://*.youtube.com/*',
        ],
    };
}

interface BuildSpec {
    background?: string;
    manifest?: Record<string, unknown>;
    extraFiles?: Record<string, string>;
}

const dirs: string[] = [];

function makeBuild(spec: BuildSpec = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'src', 'background'), { recursive: true });
    writeFileSync(
        join(dir, 'src', 'background', 'background.js'),
        spec.background ?? healthyBackground(),
    );
    writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify(spec.manifest ?? healthyManifest(), null, 2),
    );
    for (const [rel, body] of Object.entries(spec.extraFiles ?? {})) {
        const full = join(dir, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, body);
    }
    return dir;
}

/** Runs the gate; returns its exit code and combined output. */
function runGate(dir: string, env: NodeJS.ProcessEnv = process.env): { code: number; output: string } {
    // spawnSync rather than execFileSync: the gate prints every finding to
    // stderr, including in the waived case that still exits 0, and execFileSync
    // only hands back stderr when the process throws. Merging both streams
    // keeps the assertions indifferent to which one a message went to.
    const r = spawnSync('node', [GATE, dir, '--label', 'test'], { encoding: 'utf8', env });
    return { code: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('assert-shippable', () => {
    it('passes a healthy production build', () => {
        const { code, output } = runGate(makeBuild());
        expect(output).toBe('');
        expect(code).toBe(0);
    });

    describe('analytics transport', () => {
        // The regression that motivated the rule: no /mp/collect means the
        // minifier dropped the send path because the api_secret was empty.
        it('refuses a build whose GA4 transport was stripped', () => {
            const { code, output } = runGate(
                makeBuild({ background: 'const cfg = { projectId: "lingogram-prod" };' }),
            );
            expect(code).toBe(1);
            expect(output).toContain('silent no-op');
            expect(output).toContain('build-with-analytics.sh prod');
        });

        // The other direction, and the more expensive one: the transport in a
        // page-readable bundle means the api_secret shipped with it.
        it('refuses a build leaking the transport into a content bundle', () => {
            const { code, output } = runGate(makeBuild({
                extraFiles: {
                    'src/content/index.js':
                        'fetch("https://www.google-analytics.com/mp/collect?api_secret=s3cret");',
                },
            }));
            expect(code).toBe(1);
            expect(output).toContain('readable from a page');
            expect(output).toContain('src/content/index.js');
        });

        it('names every leaking bundle, not just the first', () => {
            const { code, output } = runGate(makeBuild({
                extraFiles: {
                    'src/content/index.js': 'fetch("https://x/mp/collect");',
                    'src/popup/popup.js': 'fetch("https://x/mp/collect");',
                },
            }));
            expect(code).toBe(1);
            expect(output).toContain('src/content/index.js');
            expect(output).toContain('src/popup/popup.js');
        });

        it('leaves an innocent content bundle alone', () => {
            const { code, output } = runGate(makeBuild({
                extraFiles: { 'src/content/index.js': 'console.log("no analytics here");' },
            }));
            expect(output).toBe('');
            expect(code).toBe(0);
        });

        it('refuses a build that reports to the dev property', () => {
            const { code, output } = runGate(
                makeBuild({
                    background: [
                        'const cfg = { projectId: "lingogram-prod" };',
                        `fetch("https://www.google-analytics.com/mp/collect?measurement_id=${DEV_ID}");`,
                    ].join('\n'),
                }),
            );
            expect(code).toBe(1);
            expect(output).toContain('DEV GA4 property');
        });

        it('refuses a build carrying neither property id', () => {
            const { code, output } = runGate(
                makeBuild({
                    background: [
                        'const cfg = { projectId: "lingogram-prod" };',
                        'fetch("https://www.google-analytics.com/mp/collect?measurement_id=G-ZZZZZZZZZZ");',
                    ].join('\n'),
                }),
            );
            expect(code).toBe(1);
            expect(output).toContain('no prod measurement_id');
        });

        // One cause, one message: a stripped transport has no id either, and
        // reporting both would name a consequence as if it were a second bug.
        it('reports a stripped transport without also complaining about the id', () => {
            const { output } = runGate(
                makeBuild({ background: 'const cfg = { projectId: "lingogram-prod" };' }),
            );
            expect(output).toContain('silent no-op');
            expect(output).not.toContain('no prod measurement_id');
        });
    });

    describe('the subtitle diagnostics recorder', () => {
        // The trace carries full signed timedtext URLs (signature and pot) and
        // posts them to the page with postMessage(..., '*'). Shipping it would
        // be handing every youtube.com visitor a reader for it.
        it('refuses a content bundle carrying the storage key', () => {
            const { code, output } = runGate(
                makeBuild({
                    extraFiles: { 'src/content/index.js': 'const k = "debug.trace.v1";' },
                }),
            );
            expect(code).toBe(1);
            expect(output).toMatch(/diagnostics recorder is compiled in/);
        });

        // The second marker exists because a PARTIAL fold is a real outcome,
        // not a hypothetical: during development the content bundle folded
        // correctly while the page-script still carried 1.6KB of the recorder.
        // One marker per world is what catches that.
        it('refuses a page-script carrying the handshake, even when the content bundle is clean', () => {
            const { code, output } = runGate(
                makeBuild({
                    extraFiles: {
                        'src/content/index.js': 'const clean = 1;',
                        'src/content/page-script.js': 'window.postMessage({type:"LG_TRACE_HELLO"});',
                    },
                }),
            );
            expect(code).toBe(1);
            expect(output).toMatch(/diagnostics recorder is compiled in/);
        });

        it('names the file it found the recorder in', () => {
            const { output } = runGate(
                makeBuild({ extraFiles: { 'src/content/index.js': 'const k = "debug.trace.v1";' } }),
            );
            expect(output).toMatch(/src\/content\/index\.js/);
        });

        it('passes a build where the recorder folded away', () => {
            // The healthy case: a production bundle that does the same work
            // with none of the recorder's strings in it.
            const { code, output } = runGate(
                makeBuild({
                    extraFiles: {
                        'src/content/index.js': 'const x = fetch("/api/timedtext");',
                        'src/content/page-script.js': 'window.postMessage({type:"YT_VTT_RESULT"});',
                    },
                }),
            );
            expect(output).toBe('');
            expect(code).toBe(0);
        });
    });

    describe('pre-existing rules still bite', () => {
        it('refuses a dev backend switch', () => {
            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + '\nconst m = "DEV_SET_ENV";' }),
            );
            expect(code).toBe(1);
            expect(output).toContain('dev backend switch');
        });

        it("refuses the backend switch's target table, even with the action names gone", () => {
            // The case the 'dev-env-switch' rule structurally cannot catch.
            // That rule matches DEV_GET_ENV / DEV_SET_ENV — action names the
            // minifier removes along with the guarded code. The RING is a JSON
            // string literal, which is data: nothing obliges a minifier to
            // drop it, so a guard rewritten to leave the table reachable ships
            // every environment's api key while the action names vanish
            // exactly as expected and the older rule stays green.
            const ring = JSON.stringify([
                {
                    name: 'preprod',
                    projectId: 'lingogram-preprod',
                    apiKey: 'AIzaFAKE',
                    frontendBaseUrl: 'https://preprod.example/',
                    identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
                },
            ]);
            const background =
                healthyBackground() + `\nconst R = JSON.parse(${JSON.stringify(ring)});`;
            expect(background).not.toContain('DEV_SET_ENV');
            expect(background).not.toContain('DEV_GET_ENV');

            const { code, output } = runGate(makeBuild({ background }));
            expect(code).toBe(1);
            expect(output).toContain('target table');
        });

        it('sees the table through ESCAPED quotes, not just the object form', () => {
            // The bug this pins, found by probing the rule rather than trusting
            // it: inside a JSON string literal the keys are spelled \"apiKey\",
            // and a pattern written for the object form (apiKey:) matches
            // nothing. The first version of the rule passed a build carrying a
            // full ring. Asserted on the escaped spelling ALONE so the object
            // form cannot carry the test.
            const escaped =
                '\nconst R = "[{\\"projectId\\":\\"lingogram-preprod\\",'
                + '\\"apiKey\\":\\"AIzaFAKE\\",'
                + '\\"frontendBaseUrl\\":\\"https://preprod.example/\\"}]";';
            expect(escaped).not.toMatch(/[^\\]"apiKey"\s*:/);

            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + escaped }),
            );
            expect(code).toBe(1);
            expect(output).toContain('target table');
        });

        it('does not fire on a build carrying its own single backend', () => {
            // A shippable build already contains one object with exactly these
            // keys — `config` in auth/config.ts. Matching the field names alone
            // flagged every correct build, which is how the rule was first
            // written. What must be absent is a SECOND key next to a second
            // project, so the one-backend shape has to stay green.
            const soleConfig =
                '\nconst c = { projectId: "lingogram-prod", apiKey: "AIzaPROD",'
                + ' identityToolkitUrl: "https://identitytoolkit.googleapis.com",'
                + ' frontendBaseUrl: "https://lingogram.ai" };';
            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + soleConfig }),
            );
            expect(output).toBe('');
            expect(code).toBe(0);
        });

        it('refuses a localhost origin', () => {
            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + '\nconst u = "http://localhost:5173/";' }),
            );
            expect(code).toBe(1);
            expect(output).toContain('localhost origin');
        });

        it('refuses an unsubstituted build constant', () => {
            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + '\nif (__GA4_API_SECRET__) {}' }),
            );
            expect(code).toBe(1);
            expect(output).toContain('never substituted');
        });

        it('refuses a non-prod Firebase project', () => {
            const { code, output } = runGate(
                makeBuild({
                    background: healthyBackground().replace('lingogram-prod', 'demo-lingogram'),
                }),
            );
            expect(code).toBe(1);
            expect(output).toContain('demo-lingogram');
        });

        it('refuses an unexpected externally_connectable origin', () => {
            const manifest = healthyManifest();
            (manifest.externally_connectable as { matches: string[] }).matches.push(
                'https://evil.example/*',
            );
            const { code, output } = runGate(makeBuild({ manifest }));
            expect(code).toBe(1);
            expect(output).toContain('evil.example');
        });

        it('refuses a placeholder manifest version', () => {
            const { code, output } = runGate(
                makeBuild({ manifest: { ...healthyManifest(), version: '1.0.0' } }),
            );
            expect(code).toBe(1);
            expect(output).toContain('placeholder');
        });
    });

    /**
     * The documentation names the markers; this is what keeps it true.
     *
     * dev-flags.md describes what the gate refuses, and that paragraph was
     * still naming `vtt-debug-panel` long after the marker was dropped — the
     * recorder's actions had moved out of a floating panel into settings rows,
     * the list followed, and the prose did not. A doc that names a guard the
     * guard does not have reads as coverage and is the opposite.
     *
     * Checked in BOTH directions, for the same reason assert-foldable.mjs
     * checks its own list both ways: a doc missing a real marker understates
     * the gate, and a doc naming an absent one invents protection.
     */
    describe('the documented marker list', () => {
        const DOC = join(__dirname, '..', 'docs', 'dev-flags.md');

        /**
         * The gate's own list, read out of the real .mjs by running node.
         *
         * Not a static import: this suite is transpiled to CommonJS, and an ESM
         * module cannot be required from it. Asking node for the array also
         * means the assertion is made against the file the build actually
         * loads, rather than a copy the test runner reshaped.
         */
        const gateMarkers = (): string[] => {
            const { stdout, status, stderr } = spawnSync(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `import { DEBUG_TRACE_MARKERS } from ${JSON.stringify(GATE)};` +
                        'process.stdout.write(JSON.stringify(DEBUG_TRACE_MARKERS));',
                ],
                { encoding: 'utf8' },
            );
            if (status !== 0) throw new Error(`could not read DEBUG_TRACE_MARKERS: ${stderr}`);
            return JSON.parse(stdout) as string[];
        };

        /**
         * The markers named in the paragraph that describes what the gate
         * refuses — that paragraph only, not the whole document.
         *
         * Scoped deliberately: prose elsewhere discusses markers the gate no
         * longer has (the history of `vtt-debug-panel`, right below it), and a
         * document-wide scan would read those mentions as claims about the
         * current list and fail on an accurate sentence.
         */
        function documentedMarkers(): string[] {
            const text = readFileSync(DOC, 'utf8');
            const heading = '**Between the build and the zip';
            const start = text.indexOf(heading);
            if (start === -1) throw new Error(`dev-flags.md no longer contains ${heading}`);
            // To the end of that paragraph: a blank line.
            const end = text.indexOf('\n\n', start);
            const paragraph = text.slice(start, end === -1 ? undefined : end);

            const named = new Set<string>();
            for (const [, inner] of paragraph.matchAll(/`([^`\n]+)`/g)) {
                // Only names that look like trace markers: the paragraph also
                // backticks a filename and the array's own name.
                if (/^(LG_TRACE_|vtt-(debug|trace)-|debug\.trace\.)/.test(inner)) named.add(inner);
            }
            return [...named].sort();
        }

        it('names every marker the gate actually refuses', () => {
            const documented = documentedMarkers();
            const missing = gateMarkers().filter((m) => !documented.includes(m));
            expect(missing).toEqual([]);
        });

        it('names no marker the gate does not have', () => {
            const markers = gateMarkers();
            const stale = documentedMarkers().filter((m) => !markers.includes(m));
            expect(stale).toEqual([]);
        });
    });

    describe('WRITE_UNSHIPPABLE_ZIP', () => {
        // The escape hatch must stay loud: it exits 0 so the zip is written,
        // but a silent waiver would turn "I packaged a dev build on purpose"
        // into "the gate stopped working" with nothing to tell them apart.
        it('exits 0 but still names the problem and warns not to upload', () => {
            const dir = makeBuild({ background: 'const cfg = { projectId: "lingogram-prod" };' });
            const { code, output } = runGate(dir, { ...process.env, WRITE_UNSHIPPABLE_ZIP: '1' });
            expect(code).toBe(0);
            expect(output).toContain('silent no-op');
            expect(output).toContain('UNSHIPPABLE.zip');
        });
    });
});
