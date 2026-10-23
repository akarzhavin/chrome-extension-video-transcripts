/**
 * scripts/prune-releases.mjs keeps the version in development and the five
 * before it, in releases/ and build/, and removes the rest. Run as a
 * subprocess in a scratch tree, as the Makefile runs it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/prune-releases.mjs');

function tree(versions: { youtube: string; rezka: string }, zips: string[], folders: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'prune-'));
    for (const app of ['youtube', 'rezka'] as const) {
        mkdirSync(join(dir, 'apps', app), { recursive: true });
        writeFileSync(join(dir, 'apps', app, 'package.json'), JSON.stringify({ version: versions[app] }));
    }
    mkdirSync(join(dir, 'releases'));
    for (const z of zips) writeFileSync(join(dir, 'releases', z), 'zip');
    for (const f of folders) mkdirSync(join(dir, 'build', f), { recursive: true });
    return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('developing 1.0.27: 1.0.22 and newer stay, older archives and folders go', () => {
    const dir = tree(
        { youtube: '1.0.27', rezka: '1.0.27' },
        ['youtube-v1.0.21.zip', 'youtube-v1.0.22.zip', 'youtube-v1.0.27.zip', 'rezka-v1.0.9.zip', 'rezka-v1.0.20-UNSHIPPABLE.zip', 'rezka-v1.0.26.zip', 'notes.txt'],
        ['release-1.0.21', 'release-1.0.25', 'other'],
    );
    dirs.push(dir);
    const out = run(dir);
    expect(out.status).toBe(0);
    const has = (p: string) => existsSync(join(dir, p));
    expect(has('releases/youtube-v1.0.21.zip')).toBe(false);
    expect(has('releases/rezka-v1.0.9.zip')).toBe(false);
    expect(has('releases/rezka-v1.0.20-UNSHIPPABLE.zip')).toBe(false);
    expect(has('build/release-1.0.21')).toBe(false);
    for (const p of ['releases/youtube-v1.0.22.zip', 'releases/youtube-v1.0.27.zip', 'releases/rezka-v1.0.26.zip', 'releases/notes.txt', 'build/release-1.0.25', 'build/other']) {
        expect(has(p)).toBe(true);
    }
});

test('a dry run removes nothing and says what would go', () => {
    const dir = tree({ youtube: '1.0.27', rezka: '1.0.27' }, ['youtube-v1.0.3.zip'], []);
    dirs.push(dir);
    const out = run(dir, '--dry-run');
    expect(out.stdout).toMatch(/would remove {2}releases\/youtube-v1\.0\.3\.zip/);
    expect(existsSync(join(dir, 'releases/youtube-v1.0.3.zip'))).toBe(true);
});

test('fewer than five versions into a new minor: nothing goes yet', () => {
    const dir = tree({ youtube: '1.1.3', rezka: '1.1.3' }, ['youtube-v1.0.27.zip', 'youtube-v1.1.0.zip'], []);
    dirs.push(dir);
    run(dir);
    expect(existsSync(join(dir, 'releases/youtube-v1.0.27.zip'))).toBe(true);
});

test('each edition by its own version; a shared folder goes only once stale for both', () => {
    const dir = tree({ youtube: '1.0.27', rezka: '1.0.24' }, ['youtube-v1.0.20.zip', 'rezka-v1.0.20.zip'], ['release-1.0.20']);
    dirs.push(dir);
    run(dir);
    expect(existsSync(join(dir, 'releases/youtube-v1.0.20.zip'))).toBe(false);
    expect(existsSync(join(dir, 'releases/rezka-v1.0.20.zip'))).toBe(true);
    expect(existsSync(join(dir, 'build/release-1.0.20'))).toBe(true);
});
