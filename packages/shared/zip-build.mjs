#!/usr/bin/env node
/**
 * Package build/ into releases/<app>-v<version>.zip, after the gate approves.
 *
 * Exists so the naming rule lives in ONE place. The three apps used to inline
 * the whole pipeline in package.json (`assert-shippable && mkdir && cd build &&
 * rm -f && zip -r`), which meant the suffix logic below would have had to be
 * duplicated three times in shell one-liners nobody can read.
 *
 * The rule: a build the gate rejected may still be packaged deliberately
 * (WRITE_UNSHIPPABLE_ZIP=1, e.g. handing a preprod build to a tester), but then
 * the archive is named *-UNSHIPPABLE.zip. A release and a non-shippable build
 * must never produce the same filename — that is exactly how youtube 1.0.15
 * reached the store carrying the dev backend switch and preprod.lingogram.ai
 * in externally_connectable.
 *
 * Usage: node zip-build.mjs --label youtube --version 1.0.17
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function arg(name) {
    const i = args.indexOf(`--${name}`);
    return i > -1 ? args[i + 1] : undefined;
}

const label = arg('label');
const version = arg('version');
if (!label || !version) {
    console.error('zip-build: usage: --label <app> --version <x.y.z>');
    process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const appDir = process.cwd();
const buildDir = join(appDir, 'build');

if (!existsSync(buildDir)) {
    console.error(`zip-build: ${buildDir} does not exist — run the build first`);
    process.exit(2);
}

// The gate decides shippability; this script only decides the NAME. Running it
// here rather than as a separate npm script keeps the two from drifting apart:
// there is no way to reach the packaging step without the verdict.
const gate = spawnSync(
    'node',
    [join(here, 'assert-shippable.mjs'), buildDir, '--label', label],
    { stdio: 'inherit' },
);
if (gate.status !== 0) process.exit(gate.status ?? 1);

// The gate exits 0 both when the build is clean and when it was waived, so the
// flag — not the exit code — decides the suffix.
const waived = process.env.WRITE_UNSHIPPABLE_ZIP === '1';
const suffix = waived ? '-UNSHIPPABLE' : '';
const releasesDir = join(repoRoot, 'releases');
const zipPath = join(releasesDir, `${label}-v${version}${suffix}.zip`);

mkdirSync(releasesDir, { recursive: true });
rmSync(zipPath, { force: true });

const zip = spawnSync('zip', ['-r', '-q', zipPath, '.'], {
    cwd: buildDir,
    stdio: 'inherit',
});
if (zip.status !== 0) {
    console.error('zip-build: zip failed');
    process.exit(zip.status ?? 1);
}

console.log(`  packaged: releases/${label}-v${version}${suffix}.zip`);
if (waived) {
    console.log('  NOT SHIPPABLE — do not upload this archive to the Web Store.');
}
