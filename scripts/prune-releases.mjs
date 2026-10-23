#!/usr/bin/env node
// Drops release archives (releases/<app>-v<version>[-…].zip) and unpacked
// release folders (build/release-<version>/) more than KEEP versions behind
// the one in development, read from each app's package.json. Developing
// 1.0.27 keeps 1.0.22–1.0.27 and anything newer; 1.0.21 and older go, and so
// does every older major.minor. Fewer than KEEP versions into a major.minor
// (1.1.3): nothing goes yet.
//
//   node scripts/prune-releases.mjs           remove
//   node scripts/prune-releases.mjs --dry-run say what would go

import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 5;
const APPS = ['youtube', 'rezka'];
const dry = process.argv.includes('--dry-run');

const parse = (v) => v.split('.').map(Number);
const compare = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d;
    }
    return 0;
};

/** The oldest version kept beside `current`, or null when nothing is old enough to go. */
export function floorFor(current) {
    const v = parse(current);
    const last = v.length - 1;
    if (v[last] < KEEP) return null;
    return [...v.slice(0, last), v[last] - KEEP];
}

/** Whether `version` is older than the floor kept for `current`. */
export function isStale(version, current) {
    const floor = floorFor(current);
    return floor !== null && compare(parse(version), floor) < 0;
}

function main() {
    const current = Object.fromEntries(
        APPS.map((app) => [app, JSON.parse(readFileSync(`apps/${app}/package.json`, 'utf8')).version]),
    );
    const gone = [];
    const drop = (path) => {
        gone.push(path);
        if (!dry) rmSync(path, { recursive: true, force: true });
    };

    for (const name of readdirSync('releases', { withFileTypes: true })) {
        const m = name.isFile() && name.name.match(/^([a-z]+)-v(\d+(?:\.\d+)*)(?:-[^.]+)?\.zip$/);
        if (!m || !(m[1] in current)) continue;
        if (isStale(m[2], current[m[1]])) drop(join('releases', name.name));
    }

    // One folder holds every edition of a version: it goes once it is stale for all of them.
    let folders = [];
    try {
        folders = readdirSync('build').filter((d) => /^release-\d+(\.\d+)*$/.test(d) && statSync(join('build', d)).isDirectory());
    } catch {
        /* no build/ yet */
    }
    for (const dir of folders) {
        const version = dir.slice('release-'.length);
        if (APPS.every((app) => isStale(version, current[app]))) drop(join('build', dir));
    }

    const kept = APPS.map((app) => `${app} ${current[app]}: from ${floorFor(current[app])?.join('.') ?? 'all'}`).join(', ');
    console.log(`  Keeping ${KEEP} versions back (${kept}).`);
    if (!gone.length) console.log('  Nothing older to remove.');
    for (const path of gone) console.log(`  ${dry ? 'would remove' : 'removed'}  ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
