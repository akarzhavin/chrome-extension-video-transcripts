/**
 * The dev builds' fixed ids, and the gate that keeps their key out of a release.
 *
 * The ids are pinned to literals, not recomputed: a test that derived them with
 * the same function would pass whatever the function did.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHARED = join(__dirname, '..');

/** Evaluates `expr` against the helper in a real node: jest runs CommonJS, the helper is an ES module. */
function ask(expr: string): unknown {
    const src = `import * as m from ${JSON.stringify(join(SHARED, 'vite-sibling-ids.mjs'))}; console.log(JSON.stringify(${expr}));`;
    const r = spawnSync('node', ['--input-type=module', '-e', src], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
}

describe('dev extension ids', () => {
    it('are fixed, whatever folder the build sits in', () => {
        expect(ask('m.siblingDevIds(true)')).toEqual({
            youtube: 'ajjfnojdnahbmialmfdeafejbieacnik',
            rezka: 'cgpjfahjmpfcioalbpajbdbolnckccja',
        });
    });

    it('are none for a release build', () => {
        expect(ask('m.siblingDevIds(false)')).toEqual({});
    });

    it('are derived the way Chrome derives an id from a key', () => {
        // Chrome's documented rule: SHA-256 of the DER public key, first 32 hex
        // digits, 0-f mapped to a-p. Pinned on a key whose id is computed here
        // independently, with the steps written out.
        const der = Buffer.from('lingogram-test-key');
        const hex = require('node:crypto').createHash('sha256').update(der).digest('hex').slice(0, 32) as string;
        const expected = hex.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'['0123456789abcdef'.indexOf(c)]);
        expect(ask(`m.idOfKey(${JSON.stringify(der.toString('base64'))})`)).toBe(expected);
    });
});

describe('assert-source-manifests', () => {
    const dirs: string[] = [];
    afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

    /** A repo-shaped tmp dir: the script finds apps/ next to packages/shared. */
    function repo(manifests: Record<string, Record<string, unknown>>): string {
        const root = mkdtempSync(join(tmpdir(), 'src-manifests-'));
        dirs.push(root);
        mkdirSync(join(root, 'packages', 'shared'), { recursive: true });
        copyFileSync(join(SHARED, 'assert-source-manifests.mjs'), join(root, 'packages', 'shared', 'assert-source-manifests.mjs'));
        for (const [edition, m] of Object.entries(manifests)) {
            mkdirSync(join(root, 'apps', edition), { recursive: true });
            writeFileSync(join(root, 'apps', edition, 'manifest.json'), JSON.stringify(m));
        }
        return root;
    }
    const run = (root: string, ...editions: string[]) => {
        const r = spawnSync('node', [join(root, 'packages', 'shared', 'assert-source-manifests.mjs'), ...editions], { encoding: 'utf8' });
        return { code: r.status, output: (r.stdout ?? '') + (r.stderr ?? '') };
    };

    it('passes a manifest with no key, or with the placeholder', () => {
        const root = repo({ youtube: {}, rezka: { key: 'REPLACE_WITH_BASE64_DER_KEY' } });
        expect(run(root, 'youtube', 'rezka').code).toBe(0);
    });

    it('refuses a real key, and names the edition', () => {
        const root = repo({ youtube: {}, rezka: { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' } });
        const { code, output } = run(root, 'youtube', 'rezka');
        expect(code).toBe(1);
        expect(output).toContain('rezka');
        expect(output).not.toContain('youtube:');
    });

    it('passes the repository as it is', () => {
        const r = spawnSync('node', [join(SHARED, 'assert-source-manifests.mjs'), 'youtube', 'rezka'], { encoding: 'utf8' });
        expect(r.status).toBe(0);
    });
});
