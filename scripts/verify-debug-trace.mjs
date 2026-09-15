#!/usr/bin/env node
/**
 * Run the BUILT page-script and check the diagnostics recorder actually works.
 *
 * The unit tests import TypeScript sources. This loads the emitted, minified
 * bundle — the file that is really injected into youtube.com — stands up a fake
 * MAIN world around it, and drives the cross-world handshake. It is the only
 * check that covers the gap between "the module behaves" and "the artifact
 * behaves", which is where a build-time guard can silently remove the feature.
 *
 * It also verifies the fold in a production build: the same bundle, built
 * without EXT_ENV=dev, must announce nothing at all.
 *
 * Usage:
 *   node scripts/verify-debug-trace.mjs                 # expects a dev build
 *   node scripts/verify-debug-trace.mjs --expect-prod   # expects a prod build
 *
 * Build first:
 *   cd apps/youtube && EXT_ENV=dev npx vite build --mode page-script
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO, 'apps/youtube/build/src/content/page-script.js');
const CONTENT = join(REPO, 'apps/youtube/build/src/content/index.js');
const expectProd = process.argv.includes('--expect-prod');

/**
 * What a fresh install defaults to, read out of the built bundle.
 *
 * `DEFAULT_DEBUG_MODE` is `__EXT_ENV__ === 'dev'`, which the bundler folds to a
 * literal — so this is the one place the fold is observable as a VALUE rather
 * than as the presence or absence of code. A dev build that shipped `false`
 * here would come up silent, and the only symptom would be an empty buffer at
 * the moment someone went looking.
 */
function bakedDefault() {
    if (!existsSync(CONTENT)) return null;
    const m = readFileSync(CONTENT, 'utf8').match(/debugMode:(!0|!1)/);
    if (!m) return null;
    return m[1] === '!0';
}

if (!existsSync(BUNDLE)) {
    console.error(`No bundle at ${BUNDLE}`);
    console.error('Build it: (cd apps/youtube && EXT_ENV=dev npx vite build --mode page-script)');
    process.exit(2);
}

const VIDEO_ID = 'dQw4w9WgXcQ';

/** A MAIN world with just enough of a player for broadcastCurrent() to succeed. */
function fakeWorld() {
    const posted = [];
    const listeners = [];
    const docListeners = {};
    const ctxRef = { window: null };

    const player = {
        getPlayerResponse: () => ({
            videoDetails: { videoId: VIDEO_ID },
            captions: {
                playerCaptionsTracklistRenderer: {
                    captionTracks: [
                        {
                            baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&signature=FAKE`,
                            languageCode: 'en',
                            name: { simpleText: 'English' },
                        },
                    ],
                },
            },
        }),
    };

    const doc = {
        getElementById: (id) => (id === 'movie_player' ? player : null),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (t, fn) => {
            (docListeners[t] ||= []).push(fn);
        },
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
        getElementsByTagName: () => [],
        head: null,
        documentElement: null,
        body: null,
    };

    const base = {
        location: {
            href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            pathname: '/watch',
            search: `?v=${VIDEO_ID}`,
            hostname: 'www.youtube.com',
        },
        postMessage: (m) => {
            posted.push(m);
            // `source` must be the window the SANDBOX sees. vm.createContext
            // hands back a proxy, so the object passed in is NOT the identity
            // `window` resolves to inside — and the bundle's every listener
            // starts with `if (event.source !== window) return`.
            for (const fn of listeners) fn({ source: ctxRef.window, data: m });
        },
        addEventListener: (t, fn) => {
            if (t === 'message') listeners.push(fn);
        },
        removeEventListener: () => {},
        fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }),
        setTimeout,
        clearTimeout,
        XMLHttpRequest: function XHR() {},
        performance: { getEntriesByType: () => [] },
        Response: class FakeResponse {
            constructor(body, init) {
                this.body = body;
                Object.assign(this, init);
            }
        },
        AbortController,
        AbortSignal,
        URL,
        URLSearchParams,
        console: { log() {}, warn() {}, error() {} },
        document: doc,
    };
    base.XMLHttpRequest.prototype = { open() {} };

    const ctx = vm.createContext(base);
    ctx.window = ctx;
    ctx.self = ctx;
    ctxRef.window = vm.runInContext('window', ctx);

    return { ctx, posted, docListeners };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const { ctx, posted, docListeners } = fakeWorld();
    vm.runInContext(readFileSync(BUNDLE, 'utf8'), ctx, { timeout: 10_000 });

    const announced = posted.some((m) => m?.type === 'LG_TRACE_HELLO');

    if (expectProd) {
        const leaked = posted.filter((m) => String(m?.type ?? '').startsWith('LG_TRACE'));
        if (announced || leaked.length) {
            console.error('FAIL  a production bundle announced the recorder:', leaked.map((m) => m.type));
            process.exit(1);
        }
        const def = bakedDefault();
        if (def === true) {
            console.error('FAIL  a production bundle defaults debugMode to ON');
            process.exit(1);
        }
        console.log('PASS  the production bundle carries no recorder (nothing announced)');
        if (def === false) console.log('PASS  and its baked default is off');
        return;
    }

    if (!announced) {
        console.error('FAIL  the dev bundle never posted LG_TRACE_HELLO — the recorder is not installed');
        process.exit(1);
    }
    console.log('PASS  the dev bundle announces itself on load');

    const def = bakedDefault();
    if (def === false) {
        console.error('FAIL  the dev bundle bakes debugMode OFF — a fresh profile would record nothing');
        process.exit(1);
    }
    if (def === true) console.log('PASS  a fresh profile comes up recording (baked default is on)');

    // Answer the handshake the way the isolated world does, then drive a
    // navigation so the recorder has something real to capture.
    posted.length = 0;
    await sleep(50);
    ctx.postMessage({ type: 'LG_TRACE_STATE', on: true, startedAt: Date.now() });
    await sleep(50);
    for (const fn of docListeners['yt-navigate-finish'] ?? []) fn({});
    await sleep(1200); // past the 250ms batch window

    const events = posted.filter((m) => m?.type === 'LG_TRACE_BATCH').flatMap((b) => b.events);
    if (!events.length) {
        console.error('FAIL  the recorder was switched on but streamed nothing');
        process.exit(1);
    }

    const kinds = new Set(events.map((e) => e.ev));
    const problems = [];
    for (const want of ['nav', 'player_response', 'catalog']) {
        if (!kinds.has(want)) problems.push(`missing a "${want}" event`);
    }
    const pr = events.find((e) => e.ev === 'player_response');
    // The whole point of this field: the live player API and the stale SSR copy
    // must be distinguishable, because only one of them yields URLs that serve.
    if (pr && pr.source !== 'player-api') problems.push(`player_response.source was "${pr.source}", expected "player-api"`);
    const cat = events.find((e) => e.ev === 'catalog');
    if (cat && cat.tracks?.[0]?.lang !== 'en') problems.push('the catalogue did not carry the track the player offered');
    if (!events.every((e) => typeof e.t === 'number' && e.w === 'main')) {
        problems.push('an event reached the isolated world without a timestamp or a world tag');
    }

    if (problems.length) {
        console.error('FAIL  the stream was malformed:');
        for (const p of problems) console.error('        • ' + p);
        console.error('      kinds seen: ' + JSON.stringify([...kinds]));
        process.exit(1);
    }

    console.log(`PASS  streamed ${events.length} event(s): ${JSON.stringify([...kinds])}`);
    console.log('PASS  the catalogue, the player-response source and the stamps all survived the crossing');
}

main().catch((e) => {
    console.error('FAIL  the bundle threw:', e.message);
    process.exit(1);
});
