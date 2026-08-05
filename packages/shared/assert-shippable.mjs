#!/usr/bin/env node
/**
 * Refuse to package a build that must not reach the Chrome Web Store.
 *
 * Runs between `vite build` and `zip`, so a dev or preprod build cannot become
 * a release artifact at all — the zip is never written. That matters because
 * the zip's NAME carries no evidence: `youtube-v1.0.12.zip` looks like a
 * release whether it was built for production or pointed at preprod with the
 * environment switch compiled in.
 *
 * Checks the BUILD OUTPUT rather than the env vars that produced it. Env vars
 * are what someone gets wrong; the artifact is the thing being shipped, and
 * it's the only evidence that cannot be out of date.
 *
 * Escape hatch: ALLOW_UNSHIPPABLE_ZIP=1 for deliberately packaging a dev build
 * (handing a preprod build to a tester). It prints what it waived.
 *
 * Usage: node assert-shippable.mjs <build-dir> [--label youtube]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const buildDir = process.argv[2];
const labelArg = process.argv.indexOf('--label');
const label = labelArg > -1 ? process.argv[labelArg + 1] : 'extension';

if (!buildDir) {
    console.error('assert-shippable: missing build directory argument');
    process.exit(2);
}

/** Every .js/.json/.css file in the build, recursively. */
function collect(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...collect(p));
        else if (['.js', '.json', '.css', '.html'].includes(extname(p))) out.push(p);
    }
    return out;
}

// Each rule is a distinct way a build can be unshippable. Kept separate so the
// failure message names the actual problem instead of "something looks off".
const RULES = [
    {
        id: 'dev-env-switch',
        // The prod/preprod switch is guarded by __EXT_ENV__ and should be
        // eliminated by the minifier. Its presence means EXT_ENV=dev.
        test: (s) => s.includes('DEV_GET_ENV') || s.includes('DEV_SET_ENV'),
        why: 'the dev backend switch is compiled in (built with EXT_ENV=dev)',
    },
    {
        id: 'localhost-origin',
        test: (s) => s.includes('localhost:') || s.includes('127.0.0.1:'),
        why: 'it carries a localhost origin',
    },
];

/**
 * The Firebase project the build actually resolved to.
 *
 * Read from the config object the bundler emitted rather than guessed from
 * "looks like a project id" — the code is full of DOM ids and message names
 * that begin with "lingogram-" (lingogram-rate-prompt, lingogram-auth-badge),
 * and a rule that matched those would cry wolf until the gate got ignored.
 */
function backendProblems() {
    const bg = files.find((f) => f.endsWith('background.js'));
    if (!bg) return ['no background bundle found — cannot verify the backend'];
    const src = readFileSync(bg, 'utf8');
    const m = src.match(/projectId:\s*["'`]([^"'`]+)["'`]/);
    if (!m) return ['could not determine the Firebase project from the build'];
    return m[1] === 'lingogram-prod'
        ? []
        : [`it targets Firebase project "${m[1]}", not lingogram-prod`];
}

// The manifest is checked separately: origins live only there, and a bad one
// silently widens what can talk to the extension.
function manifestProblems(dir) {
    const problems = [];
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    } catch {
        return ['manifest.json is missing or unreadable'];
    }

    const origins = [
        ...(manifest.externally_connectable?.matches ?? []),
        ...(manifest.host_permissions ?? []),
    ];
    const bad = origins.filter(
        (o) => o.includes('localhost') || o.includes('127.0.0.1') || /\/\/(?!lingogram\.ai)[a-z0-9-]+\.lingogram\.ai/.test(o),
    );
    if (bad.length) problems.push(`manifest allows non-production origins: ${bad.join(', ')}`);

    if (manifest.version === '0.0.0' || manifest.version === '1.0.0') {
        problems.push(
            `manifest version is ${manifest.version} — the placeholder, not the extension's version. ` +
            'This happens when vite runs outside `npm run build`, so npm_package_version is unset ' +
            'or comes from the monorepo root.',
        );
    }
    return problems;
}

const files = collect(buildDir);
const findings = [];

for (const rule of RULES) {
    const hits = files.filter((f) => rule.test(readFileSync(f, 'utf8')));
    if (hits.length) {
        findings.push(`${rule.why}\n      ${hits.map((h) => h.replace(buildDir + '/', '')).join('\n      ')}`);
    }
}
findings.push(...backendProblems());
findings.push(...manifestProblems(buildDir));

if (!findings.length) process.exit(0);

const waived = process.env.ALLOW_UNSHIPPABLE_ZIP === '1';
const head = waived ? 'PACKAGING A NON-SHIPPABLE BUILD' : 'REFUSING TO PACKAGE';

console.error('');
console.error(`  ${head} — ${label}`);
console.error('');
for (const f of findings) console.error(`    • ${f}`);
console.error('');

if (waived) {
    console.error('  Waived via ALLOW_UNSHIPPABLE_ZIP=1. Do not upload this zip to the Web Store.');
    console.error('');
    process.exit(0);
}

console.error('  A production build is what `npm run build` makes with no EXT_* overrides.');
console.error('  To package a dev build anyway: ALLOW_UNSHIPPABLE_ZIP=1 npm run build');
console.error('');
process.exit(1);
