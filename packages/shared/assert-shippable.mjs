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

// What a shipped manifest is allowed to say. Checked against a fixed list
// rather than a "looks suspicious" pattern: a pattern only catches the bad
// origins someone thought of, while an exact list also catches the ones nobody
// anticipated — a new staging host, a colleague's tunnel, a typo'd domain.
//
// externally_connectable is pinned EXACTLY. It is the shortest and most
// dangerous list in the manifest: every origin on it can hand this extension a
// signed-in user's SSO token, so an unexpected entry is a security finding, not
// a style problem.
const ALLOWED_EXTERNALLY_CONNECTABLE = ['https://lingogram.ai/*'];

// host_permissions is checked in two halves. The infrastructure origins (the
// backends the extension calls) are pinned exactly; the content-site origins
// are not, because Rezka alone ships ~250 mirror domains and that list changes
// whenever a mirror appears. Pinning those would make the gate fail on routine
// edits, and a gate that cries wolf stops being read.
const ALLOWED_INFRA_HOSTS = [
    'https://identitytoolkit.googleapis.com/*',
    'https://securetoken.googleapis.com/*',
    'https://firestore.googleapis.com/*',
];

// Content sites the extension reads subtitles on. Rezka ships ~250 entries, but
// they are only a handful of NAMES across many TLDs (hdrezka.ag, hdrezka.to,
// rezka.ru, …), so the second-level name is pinned and only the zone is free.
// That is what keeps a lookalike like "rezka-evil.com" from passing as a mirror
// while a genuinely new zone still needs no gate edit.
const CONTENT_SITE_NAMES = [
    'youtube.com',
    'netflix.com',
    'voidboost.com',
    'rezka-ua.tv',
    'hdrezka-home.tv',
];
const CONTENT_SITE_WILDCARD_NAMES = ['rezka', 'hdrezka'];

// A single TLD label only — no second dot. Allowing one would let
// "hdrezka.evil.com" pass as a mirror, and the real list uses none: all 177
// zones are flat (.ag, .to, .xn--p1ai). If a mirror ever needs a multi-label
// zone like .co.uk, add it here explicitly rather than loosening this.
const ZONE = String.raw`[a-z]{2,}|xn--[a-z0-9]+`;
const CONTENT_ORIGIN_RE = new RegExp(
    `^\\*?(https?|\\*)://(\\*\\.)?(` +
    CONTENT_SITE_NAMES.map((n) => n.replace(/\./g, '\\.')).join('|') +
    `|(${CONTENT_SITE_WILDCARD_NAMES.join('|')})\\.(${ZONE})` +
    `)/`,
);

// An origin belongs to a content site rather than to our own infrastructure.
// Everything else must be on the infra allow-list above.
function isContentSiteOrigin(origin) {
    return CONTENT_ORIGIN_RE.test(origin);
}

// The manifest is checked separately from the bundles: origins live only there,
// and a bad one silently widens what is allowed to talk to the extension.
function manifestProblems(dir) {
    const problems = [];
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    } catch {
        return ['manifest.json is missing or unreadable'];
    }

    const ext = manifest.externally_connectable?.matches ?? [];
    const extUnexpected = ext.filter((o) => !ALLOWED_EXTERNALLY_CONNECTABLE.includes(o));
    const extMissing = ALLOWED_EXTERNALLY_CONNECTABLE.filter((o) => !ext.includes(o));
    if (extUnexpected.length) {
        problems.push(
            `externally_connectable lists origins that must not ship: ${extUnexpected.join(', ')}\n` +
            '      Every origin here can hand the extension a signed-in user\'s SSO token.',
        );
    }
    if (extMissing.length) {
        // Not a security problem, but a broken build: sign-in cannot complete.
        problems.push(`externally_connectable is missing ${extMissing.join(', ')} — sign-in would not connect`);
    }

    const hosts = manifest.host_permissions ?? [];
    const infraUnexpected = hosts.filter(
        (o) => !isContentSiteOrigin(o) && !ALLOWED_INFRA_HOSTS.includes(o),
    );
    if (infraUnexpected.length) {
        problems.push(
            `host_permissions lists non-production or unknown origins: ${infraUnexpected.join(', ')}\n` +
            '      Expected only content sites plus: ' + ALLOWED_INFRA_HOSTS.join(', '),
        );
    }
    const infraMissing = ALLOWED_INFRA_HOSTS.filter((o) => !hosts.includes(o));
    if (infraMissing.length) {
        problems.push(`host_permissions is missing ${infraMissing.join(', ')} — auth or saving would fail`);
    }

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
