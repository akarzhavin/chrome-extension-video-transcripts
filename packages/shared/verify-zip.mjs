#!/usr/bin/env node
/**
 * Run the release gate against a ZIP, not a build directory.
 *
 * The gate normally inspects build/ — a directory that is overwritten by the
 * next build, dev or prod. So "the gate passed" is a statement about whatever
 * was in build/ at some past moment, not about the archive now sitting in
 * releases/. Those came apart in practice: releases/youtube-v1.0.15.zip was
 * written by a dev run while a prod build had passed the gate earlier the same
 * day.
 *
 * This is the last check before an upload, and the only one whose subject is
 * byte-for-byte the file that goes to the store.
 *
 * On top of every rule assert-shippable applies, it adds the three checks that
 * only make sense against a finished archive:
 *
 *   - the api_secret must not appear in a page-readable bundle. The build
 *     script checks this too, but only against build/ and only when the build
 *     ran through it — an archive from any other route was never checked.
 *   - the manifest version must match the version in the filename, or the file
 *     is not what its name claims.
 *   - no stray files (source maps, .env, .DS_Store, TypeScript sources).
 *     A source map republishes readable source, and a bundled .env would ship
 *     the secret outright.
 *
 * Usage: node verify-zip.mjs releases/youtube-v1.0.17.zip
 *        npm run verify-zip -- releases/youtube-v1.0.17.zip
 */
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    rmSync,
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const zipPath = process.argv[2];
if (!zipPath) {
    console.error('verify-zip: usage: node verify-zip.mjs <path-to-zip>');
    process.exit(2);
}
if (!existsSync(zipPath)) {
    console.error(`verify-zip: ${zipPath} not found`);
    process.exit(2);
}

const name = basename(zipPath);

// Named by the packager precisely so it cannot be uploaded by accident. Refuse
// before unpacking: there is no verdict worth printing about an archive that
// must not ship regardless of its contents.
if (name.includes('UNSHIPPABLE')) {
    console.error('');
    console.error(`  NOT SHIPPABLE — ${name}`);
    console.error('');
    console.error('  This archive was packaged from a build the gate rejected');
    console.error('  (WRITE_UNSHIPPABLE_ZIP=1). Do not upload it to the Web Store.');
    console.error('');
    process.exit(1);
}

// <app>-v<version>.zip → the label the gate reports under.
const m = name.match(/^([a-z]+)-v[\d.]+\.zip$/);
if (!m) {
    console.error(`verify-zip: cannot read an app name from "${name}"`);
    console.error('            expected <app>-v<version>.zip');
    process.exit(2);
}
const label = m[1];

/** Every file in the unpacked archive, as paths relative to its root. */
function walk(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full, base));
        else out.push(relative(base, full));
    }
    return out;
}

// Bundles that run in a page context, where the api_secret must never appear.
// analytics-bg is service-worker-only by construction; the secret reaching one
// of these means it leaked through the shared barrel and is readable by any
// script on any page the extension touches.
const PAGE_READABLE = [
    'src/content/index.js',
    'src/content/page-script.js',
    'src/popup/popup.js',
];

// Files that have no business in a published extension. Source maps hand out
// readable source; a bundled .env hands out the secret itself.
const STRAY = [
    { test: (f) => f.endsWith('.map'), why: 'a source map (republishes readable source)' },
    { test: (f) => basename(f) === '.env' || basename(f).startsWith('.env.'), why: 'an .env file' },
    { test: (f) => basename(f) === '.DS_Store', why: 'a .DS_Store' },
    { test: (f) => extname(f) === '.ts', why: 'a TypeScript source file' },
    { test: (f) => f.split('/').includes('node_modules'), why: 'a node_modules entry' },
];

/**
 * Checks that only make sense against a finished archive.
 *
 * Deliberately NOT folded into assert-shippable: that gate runs on build/
 * before packaging, where the filename does not exist yet and the api_secret
 * is still an environment variable rather than something to search for.
 */
function archiveProblems(root, archiveName) {
    const problems = [];
    const files = walk(root);

    // 1. The api_secret must not be in a page-readable bundle.
    //
    // Read from the background bundle rather than from the environment: the
    // whole point is to check an archive that may have been built anywhere, by
    // anyone, possibly with a secret this shell has never seen.
    const bgPath = join(root, 'src/background/background.js');
    if (existsSync(bgPath)) {
        const bg = readFileSync(bgPath, 'utf8');
        const m = bg.match(/api_secret=([A-Za-z0-9_-]{10,})/);
        if (m) {
            const secret = m[1];
            for (const rel of PAGE_READABLE) {
                const full = join(root, rel);
                if (!existsSync(full)) continue;
                if (readFileSync(full, 'utf8').includes(secret)) {
                    problems.push(
                        `the GA4 api_secret is present in ${rel}, a bundle that runs in the page\n` +
                        '      Any script on any page the extension touches can read it. Do not ship.',
                    );
                }
            }
        }
    }

    // 2. The manifest version must match the name on the tin.
    const manifestPath = join(root, 'manifest.json');
    if (existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            const named = archiveName.match(/-v([\d.]+)\.zip$/)?.[1];
            if (named && manifest.version !== named) {
                problems.push(
                    `the archive is named v${named} but its manifest says ${manifest.version} — ` +
                    'the file is not what its name claims',
                );
            }
        } catch {
            problems.push('manifest.json is unreadable');
        }
    }

    // 3. Nothing stray.
    for (const rule of STRAY) {
        const hits = files.filter(rule.test);
        if (hits.length) {
            problems.push(`it contains ${rule.why}:\n      ${hits.slice(0, 5).join('\n      ')}`);
        }
    }

    return problems;
}

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'verify-zip-'));
try {
    const unzip = spawnSync('unzip', ['-q', zipPath, '-d', tmp], { stdio: 'inherit' });
    if (unzip.status !== 0) {
        console.error('verify-zip: could not unpack the archive');
        process.exit(2);
    }

    // No waiver here, deliberately: WRITE_UNSHIPPABLE_ZIP exists to let someone
    // package a known-bad build, never to bless one for upload. Stripping it
    // from the child's env means this check cannot be talked out of a verdict.
    const env = { ...process.env };
    delete env.WRITE_UNSHIPPABLE_ZIP;

    const gate = spawnSync(
        'node',
        [join(here, 'assert-shippable.mjs'), tmp, '--label', label],
        { stdio: 'inherit', env },
    );

    const problems = archiveProblems(tmp, name);

    if (gate.status !== 0 || problems.length) {
        // assert-shippable has already printed its own findings under a header;
        // only add one if it stayed silent, so the output never shows two.
        if (problems.length) {
            if (gate.status === 0) {
                console.error('');
                console.error(`  REFUSING TO SHIP — ${name}`);
                console.error('');
            }
            for (const p of problems) console.error(`    • ${p}`);
            console.error('');
        }
        console.error(`  ^ ${name} must NOT be uploaded.`);
        console.error('');
        process.exit(1);
    }

    console.log('');
    console.log(`  ${name} is shippable.`);
    console.log('');
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
