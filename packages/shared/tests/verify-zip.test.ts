/**
 * The pre-upload gate, tested against real .zip archives.
 *
 * Separate from assert-shippable.test.ts because the subject is different: that
 * one checks the rules applied to a build directory, this one checks the three
 * things that only exist once an archive does — a filename, a packed file list,
 * and an api_secret sitting in the bundle rather than in the environment.
 *
 * Every case builds an actual zip. Asserting on a hand-made directory would
 * skip the packing step, which is where a stray file or a renamed archive
 * enters in real life.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERIFY = join(__dirname, '..', 'verify-zip.mjs');
const PROD_ID = 'G-09BWM1R5S5';
const SECRET = 'oZGdXkyMSJ6_3WZdeIFM0Q';

const dirs: string[] = [];

function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), 'vz-'));
    dirs.push(d);
    return d;
}

/** A build tree that passes every rule, ready to be zipped. */
function healthyTree(root: string, version = '1.0.17'): void {
    mkdirSync(join(root, 'src', 'background'), { recursive: true });
    mkdirSync(join(root, 'src', 'content'), { recursive: true });
    writeFileSync(
        join(root, 'src', 'background', 'background.js'),
        [
            'const cfg = { projectId: "lingogram-prod" };',
            `fetch("https://www.google-analytics.com/mp/collect?measurement_id=${PROD_ID}&api_secret=${SECRET}");`,
        ].join('\n'),
    );
    writeFileSync(join(root, 'src', 'content', 'index.js'), 'const ui = 1;');
    writeFileSync(
        join(root, 'manifest.json'),
        JSON.stringify(
            {
                manifest_version: 3,
                version,
                externally_connectable: { matches: ['https://lingogram.ai/*'] },
                host_permissions: [
                    'https://identitytoolkit.googleapis.com/*',
                    'https://securetoken.googleapis.com/*',
                    'https://firestore.googleapis.com/*',
                ],
            },
            null,
            2,
        ),
    );
}

/** Packs a tree into <name> and returns the archive path. */
function pack(tree: string, name: string): string {
    const out = scratch();
    const zipPath = join(out, name);
    const r = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: tree });
    if (r.status !== 0) throw new Error('zip failed');
    return zipPath;
}

function verify(zipPath: string): { code: number; output: string } {
    const r = spawnSync('node', [VERIFY, zipPath], { encoding: 'utf8' });
    return { code: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** The common case: a healthy tree packed under a correct name. */
function healthyZip(name = 'youtube-v1.0.17.zip'): string {
    const tree = scratch();
    healthyTree(tree);
    return pack(tree, name);
}

afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('verify-zip', () => {
    it('accepts a healthy release archive', () => {
        const { code, output } = verify(healthyZip());
        expect(code).toBe(0);
        expect(output).toContain('is shippable');
    });

    it('refuses an archive named UNSHIPPABLE without even unpacking it', () => {
        // Healthy contents on purpose: the name alone must decide, since that
        // is what marks a build the gate already rejected.
        const { code, output } = verify(healthyZip('youtube-v1.0.17-UNSHIPPABLE.zip'));
        expect(code).toBe(1);
        expect(output).toContain('NOT SHIPPABLE');
    });

    it('refuses a filename it cannot read an app name from', () => {
        const { code, output } = verify(healthyZip('final-build.zip'));
        expect(code).toBe(2);
        expect(output).toContain('cannot read an app name');
    });

    describe('archive-only checks', () => {
        it('refuses a secret that reached a page-readable bundle', () => {
            const tree = scratch();
            healthyTree(tree);
            writeFileSync(join(tree, 'src', 'content', 'index.js'), `const k = "${SECRET}";`);
            const { code, output } = verify(pack(tree, 'youtube-v1.0.17.zip'));
            expect(code).toBe(1);
            expect(output).toContain('api_secret is present in src/content/index.js');
        });

        it('refuses a manifest version that disagrees with the filename', () => {
            const tree = scratch();
            healthyTree(tree, '9.9.9');
            const { code, output } = verify(pack(tree, 'youtube-v1.0.17.zip'));
            expect(code).toBe(1);
            expect(output).toContain('not what its name claims');
        });

        it.each([
            ['a source map', 'src/background/background.js.map', 'source map'],
            ['an .env file', '.env', '.env file'],
            ['a .DS_Store', '.DS_Store', '.DS_Store'],
            ['a TypeScript source', 'src/background/background.ts', 'TypeScript source'],
        ])('refuses %s', (_label, rel, expected) => {
            const tree = scratch();
            healthyTree(tree);
            const full = join(tree, rel);
            mkdirSync(join(full, '..'), { recursive: true });
            writeFileSync(full, 'x');
            const { code, output } = verify(pack(tree, 'youtube-v1.0.17.zip'));
            expect(code).toBe(1);
            expect(output).toContain(expected);
        });
    });

    describe('inherited assert-shippable rules', () => {
        it('refuses an archive whose GA4 transport was stripped', () => {
            const tree = scratch();
            healthyTree(tree);
            writeFileSync(
                join(tree, 'src', 'background', 'background.js'),
                'const cfg = { projectId: "lingogram-prod" };',
            );
            const { code, output } = verify(pack(tree, 'youtube-v1.0.17.zip'));
            expect(code).toBe(1);
            expect(output).toContain('silent no-op');
        });

        // The escape hatch may excuse packaging; it must never excuse shipping.
        it('ignores WRITE_UNSHIPPABLE_ZIP in the environment', () => {
            const tree = scratch();
            healthyTree(tree);
            writeFileSync(
                join(tree, 'src', 'background', 'background.js'),
                'const cfg = { projectId: "lingogram-prod" };',
            );
            const zipPath = pack(tree, 'youtube-v1.0.17.zip');
            const r = spawnSync('node', [VERIFY, zipPath], {
                encoding: 'utf8',
                env: { ...process.env, WRITE_UNSHIPPABLE_ZIP: '1' },
            });
            expect(r.status).toBe(1);
        });

        it('prints one refusal header, not two, when both halves object', () => {
            const tree = scratch();
            healthyTree(tree);
            writeFileSync(
                join(tree, 'src', 'background', 'background.js'),
                'const cfg = { projectId: "lingogram-prod" };',
            );
            writeFileSync(join(tree, '.env'), 'SECRET=x');
            const { output } = verify(pack(tree, 'youtube-v1.0.17.zip'));
            expect(output.match(/REFUSING/g) ?? []).toHaveLength(1);
        });
    });
});
