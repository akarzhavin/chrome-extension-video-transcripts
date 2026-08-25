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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

    describe('pre-existing rules still bite', () => {
        it('refuses a dev backend switch', () => {
            const { code, output } = runGate(
                makeBuild({ background: healthyBackground() + '\nconst m = "DEV_SET_ENV";' }),
            );
            expect(code).toBe(1);
            expect(output).toContain('dev backend switch');
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
