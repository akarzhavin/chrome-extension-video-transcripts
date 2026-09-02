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
 * Escape hatch: WRITE_UNSHIPPABLE_ZIP=1 for deliberately packaging a build that
 * must never reach the store (handing a preprod build to a tester). It prints
 * what it waived, and zip-build.mjs names the archive *-UNSHIPPABLE.zip so the
 * artifact stays distinguishable from a release in the file picker. The old
 * name (ALLOW_UNSHIPPABLE_ZIP) described permission to package; what actually
 * matters is that the resulting FILE is marked.
 *
 * Usage: node assert-shippable.mjs <build-dir> [--label youtube]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

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
    {
        id: 'unsubstituted-define',
        // A __EXT_*__ / __GA4_*__ / __LIMIT_*__ identifier that survived into
        // the bundle was never given a `define` in that app's vite.config.ts.
        // At runtime it is a ReferenceError thrown during module evaluation —
        // in a service worker that means NO listener is ever registered and the
        // extension is silently dead, with nothing shown on chrome://extensions.
        // Cost us a real regression: importing auth/devEnvSwitch into apps/web,
        // which has no __EXT_ALT_*__ defines, disabled that whole extension.
        // JS only: an identifier is only dangerous where it gets evaluated.
        // CSS and HTML mention these names in comments (styles.css explains
        // that a dev-only affordance sits behind an __EXT_ENV__ literal), and
        // flagging prose would make the gate cry wolf until someone disables it.
        files: (f) => f.endsWith('.js'),
        test: (s) => /(?:^|[^.\w])__(?:EXT|GA4|LIMIT)_[A-Z0-9_]+__/.test(s),
        why: 'it references a build constant that was never substituted (the worker will throw on load and register no listeners)',
    },
];

/**
 * The GA4 property a release must report to. Prod only — a dev id here means
 * the build was made against `Lingogram dev`, and its traffic would land in the
 * property whose whole purpose is to stay free of real users.
 */
const PROD_MEASUREMENT_ID = 'G-09BWM1R5S5';
const DEV_MEASUREMENT_ID = 'G-V0MLJ7ZFNC';

/**
 * Analytics must survive into the background bundle.
 *
 * This is the one failure the other rules structurally cannot catch. They all
 * look for something that must NOT be present (a dev switch, a localhost
 * origin, an unsubstituted define); this one looks for something that MUST be,
 * because the failure REMOVES code rather than adding it.
 *
 * Built without EXT_GA4_API_SECRET, the guard at the top of track() —
 * `if (!__GA4_MEASUREMENT_ID__ || !__GA4_API_SECRET__) return;` — folds to a
 * constant and the minifier drops the entire transport path. The result is a
 * build that installs, runs, loads subtitles and reports NOTHING, with no error
 * anywhere. Shipped twice before this rule existed: youtube 1.0.15 and 1.0.16
 * (and rezka 1.0.15) went to the store mute, and the gap only surfaced when a
 * month of GA4 data turned out to end on the day 1.0.15 was published.
 *
 * The transport is checked for PRESENCE in the background bundle and for
 * ABSENCE everywhere else. analytics-bg is service-worker-only; the string
 * turning up in a page-readable bundle means the api_secret shipped with it,
 * readable by anyone viewing source on youtube.com. That direction was stated
 * here as a rule for a while before anything enforced it.
 */
function analyticsProblems() {
    const bg = files.find((f) => f.endsWith('background.js'));
    // A missing background bundle is already reported by backendProblems().
    if (!bg) return [];
    const src = readFileSync(bg, 'utf8');

    const problems = [];
    if (!src.includes('/mp/collect')) {
        problems.push(
            'the GA4 transport is missing from the background bundle — analytics is a silent no-op\n' +
            '      Built without EXT_GA4_API_SECRET, so the minifier dropped the whole send path.\n' +
            '      Build releases with: ./scripts/build-with-analytics.sh prod',
        );
        // The id check below would only restate the same cause.
        return problems;
    }

    const ids = [...new Set(src.match(/G-[A-Z0-9]{8,}/g) ?? [])];
    if (ids.includes(DEV_MEASUREMENT_ID)) {
        problems.push(
            `it reports to the DEV GA4 property (${DEV_MEASUREMENT_ID}) — test traffic would enter the real funnel\n` +
            '      and cannot be separated out afterwards. Rebuild with the prod credentials.',
        );
    } else if (!ids.includes(PROD_MEASUREMENT_ID)) {
        problems.push(
            `the background bundle carries no prod measurement_id (${PROD_MEASUREMENT_ID}); found: ${ids.join(', ') || 'none'}`,
        );
    }
    // The other half of the rule: the transport, and the api_secret baked into
    // it, must not reach anything a page can read. A leak here is not a silent
    // no-op like the case above — it is a credential handed to every visitor.
    const leaked = files.filter((f) => !f.endsWith('background.js'))
        .filter((f) => readFileSync(f, 'utf8').includes('/mp/collect'));
    if (leaked.length) {
        problems.push(
            'the GA4 transport is present outside the background bundle — the api_secret is readable from a page\n' +
            `      Affected: ${leaked.map((f) => relative(buildDir, f)).join(', ')}\n` +
            '      analytics-bg.ts must never be reachable from a content or popup entry point.',
        );
    }

    return problems;
}

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

// Infra origins a release MAY carry but does not have to. The lookup API's
// production origin appears only when EXT_API_BASE_URL was set at build time;
// a build pointed at preprod carries a run.app origin instead and still fails
// the gate, which is exactly right — preprod must never reach the store.
// Separate from ALLOWED_INFRA_HOSTS because that list is also REQUIRED
// (infraMissing below), and a release without the lookup feature is shippable.
const OPTIONAL_INFRA_HOSTS = [
    'https://api.lingogram.ai/*',
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
        (o) => !isContentSiteOrigin(o)
            && !ALLOWED_INFRA_HOSTS.includes(o)
            && !OPTIONAL_INFRA_HOSTS.includes(o),
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
    const scope = rule.files ? files.filter(rule.files) : files;
    const hits = scope.filter((f) => rule.test(readFileSync(f, 'utf8')));
    if (hits.length) {
        findings.push(`${rule.why}\n      ${hits.map((h) => h.replace(buildDir + '/', '')).join('\n      ')}`);
    }
}
findings.push(...backendProblems());
findings.push(...analyticsProblems());
findings.push(...manifestProblems(buildDir));

if (!findings.length) process.exit(0);

const waived = process.env.WRITE_UNSHIPPABLE_ZIP === '1';
const head = waived ? 'PACKAGING A NON-SHIPPABLE BUILD' : 'REFUSING TO PACKAGE';

console.error('');
console.error(`  ${head} — ${label}`);
console.error('');
for (const f of findings) console.error(`    • ${f}`);
console.error('');

if (waived) {
    console.error('  Waived via WRITE_UNSHIPPABLE_ZIP=1 — the archive will be named');
    console.error('  *-UNSHIPPABLE.zip so it cannot be picked for an upload by mistake.');
    console.error('');
    process.exit(0);
}

console.error('  A shippable build is what `./scripts/build-with-analytics.sh prod` makes:');
console.error('  production backends AND live GA4 credentials. Plain `npm run build` gives');
console.error('  the first without the second, which ships mute analytics.');
console.error('  To package such a build anyway: WRITE_UNSHIPPABLE_ZIP=1 npm run build');
console.error('  (it will be written as <app>-v<version>-UNSHIPPABLE.zip)');
console.error('');
process.exit(1);
