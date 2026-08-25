// Live check for the fix/analytics-tracking-quality release (checklist 2c.7).
//
// Separate from verify-analytics-live.mjs on purpose: that script's 2.17 treats
// `failure: 'unknown'` as a failure, which was right when any non-empty reason
// meant a real fetch result. Under the new taxonomy 'no-tracks' is the CORRECT
// answer for a video with no captions, and 'unknown' is a legitimate — if
// uninformative — fallback. Asserting both contracts in one function would mean
// one of them is always wrong.
//
// What it pins:
//   - no_subtitles never carries an empty `failure` (the 71% production bug)
//   - each label matches the REAL condition that produced it, not just the
//     closed vocabulary — a wrong label is worse than an empty one, because it
//     looks like truth
//   - no_subtitles carries learning/native, equal to what storage holds
//   - word_save_attempt / word_saved carry learning/native (+ signed_in)
//
// Usage (the human does the Preparation steps in docs/ops/analytics-manual-check.md):
//
//   node scripts/verify-failure-taxonomy.mjs                 # everything
//   node scripts/verify-failure-taxonomy.mjs --skip-human    # unattended subset
//   node scripts/verify-failure-taxonomy.mjs --only C1,C4
//
// Reads nothing from the profile and writes nothing to it, EXCEPT that it
// disables the Web Store copy for the duration (restored in a finally) and
// reloads the unpacked build. Both are mandatory: two copies share the #vtt-*
// DOM ids and the same postMessage protocol, and a cached content script is the
// most expensive mistake in this loop.

import { chromium } from '../node_modules/playwright-core/index.mjs';
import { openInBackground, mute } from './lib/cdp-background-tab.mjs';
import { watchWorkerNetwork } from './lib/cdp-worker-net.mjs';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (f) => argv.includes(f);

const PORT = argOf('--port', '9333');
// "Me at the zoo" — the first YouTube video, reliably caption-free.
const NO_CAPTIONS = argOf('--nocaps', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
// C5 needs a SECOND caption-free video: analyticsOnce fires no_subtitles once
// per video, so reusing the one from [A] yields nothing to assert on.
const NO_CAPTIONS_2 = argOf('--nocaps2', 'https://www.youtube.com/watch?v=BHACKCNDMW8');
// Captioned videos. Each scenario needs its OWN video id: analyticsOnce re-arms
// only in resetNoSubsRetries(), which runs on a genuine video change — so one
// video yields exactly one no_subtitles however many times we provoke it.
const VIDEOS = {
    recover:  argOf('--v-recover',  'https://www.youtube.com/watch?v=aircAruvnKk'),
    notOffer: argOf('--v-notoffer', 'https://www.youtube.com/watch?v=IHZwWFHWa-w'),
    stale:    argOf('--v-stale',    'https://www.youtube.com/watch?v=Unzc731iCUY'),
    limited:  argOf('--v-limited',  'https://www.youtube.com/watch?v=8jPQjjsBbIc'),
    // Retry-After must be small enough that MAX_ATTEMPTS retries finish inside
    // the 7s grace timer (app-base.ts scheduleNoSubtitlesCheck). With 5s the
    // timer fires mid-backoff and the honest label is 'timeout', not
    // 'rate-limited' — the product is right and the test would be wrong.
    cooldown: argOf('--v-cooldown', 'https://www.youtube.com/watch?v=rfscVS0vtbw'),
};
// 40s, not 30: tabs now open in the BACKGROUND so the run stays invisible to
// whoever is using the browser, and Chrome throttles timers in unfocused
// tabs. At 30s the 429 leg intermittently reported nothing at all.
const SETTLE_MS = Number(argOf('--settle', '40000'));
const RETRY_AFTER_S = Number(argOf('--retry-after', '1'));
const HUMAN_WAIT = Number(argOf('--human-wait', '90000'));
const WORD_WAIT = Number(argOf('--word-wait', '90000'));
const NETFLIX_URL = argOf('--netflix', 'https://www.netflix.com/browse');
const SKIP_HUMAN = hasFlag('--skip-human');
const NO_RELOAD = hasFlag('--no-reload');
const KEEP_STORE = hasFlag('--keep-store');
const ONLY = argOf('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);

// The vocabulary as the shipped code declares it: VttFailure in
// apps/youtube/src/content/timedtext-fetch.ts, NoSubsCause in
// apps/youtube/src/content/app-base.ts, plus rezka's 'not-selected'.
// 'aborted' is deliberately excluded from dominantFailure(), so it can never be
// the reported value.
const EXPECTED_ABSENCE = ['no-tracks', 'no-language-match', 'not-selected'];
const INCONCLUSIVE = ['not-attempted', 'unknown'];
const REAL_FAILURE = ['rate-limited', 'cooldown', 'stale-url', 'no-pot',
                      'network', 'timeout', 'not-offered', 'unavailable'];
const VOCABULARY = [...EXPECTED_ABSENCE, ...INCONCLUSIVE, ...REAL_FAILURE];

// The dev property. If a hit carries anything else we are on a prod build and
// every event this script provokes is fabricated data in the real funnel.
const DEV_MEASUREMENT_ID = 'G-V0MLJ7ZFNC';

let browser;
try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch (e) {
    console.error(`\nНе удалось подключиться к Chrome на порту ${PORT}.`);
    console.error('Запусти Chrome с флагом отладки (шаг «Подготовка»):\n');
    console.error(`  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\`);
    console.error(`    --remote-debugging-port=${PORT} \\`);
    console.error(`    --user-data-dir=$HOME/chrome-lingogram-test &\n`);
    console.error(String(e).split('\n')[0]);
    process.exit(1);
}

const ctx = browser.contexts()[0];
if (!ctx) {
    console.error('У браузера нет контекста — открыто ли хоть одно окно?');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Capture: GA4 hits, and separately the Firestore commits REPORT_NO_SUBS makes.
// ---------------------------------------------------------------------------
const hits = [];
const seenReq = new Set();
const commits = [];
let sawProdEndpoint = null;

const record = (req) => {
    const url = req.url();
    if (/google-analytics\.com/.test(url)) {
        // The prod-build tripwire: /mp/collect (not /debug/) or the prod id.
        if (!/\/debug\/mp\/collect/.test(url) || !url.includes(DEV_MEASUREMENT_ID)) {
            const m = /measurement_id=([^&]+)/.exec(url);
            sawProdEndpoint ??= `${/\/debug\//.test(url) ? '/debug/mp/collect' : '/mp/collect'}` +
                                ` measurement_id=${m ? decodeURIComponent(m[1]) : '?'}`;
        }
        try {
            const body = JSON.parse(req.postData() ?? '{}');
            for (const e of body.events ?? []) {
                hits.push({ at: Date.now(), name: e.name, params: e.params ?? {} });
            }
        } catch { /* an unparseable hit is still not one we can assert on */ }
        return;
    }
    // The diagnostics drop-box write from the "Reload page" button.
    if (/firestore\.googleapis\.com/.test(url) && /:commit/.test(url)) {
        try {
            const body = JSON.parse(req.postData() ?? '{}');
            for (const w of body.writes ?? []) {
                if (w.update?.fields) commits.push({ at: Date.now(), fields: w.update.fields });
            }
        } catch { /* ignore */ }
    }
};
ctx.on('request', record);
for (const w of ctx.serviceWorkers?.() ?? []) w.on?.('request', record);
ctx.on('serviceworker', (w) => w.on?.('request', record));

// The worker's own requests never reach the listeners above: an MV3 worker
// wakes, sends, and dies, and playwright reports zero service workers for this
// extension throughout. Everything the background sends — the GA4 hits and the
// diagnostics commit alike — is only visible from the browser endpoint.
let stopWorkerWatch = () => {};
function recordWorker({ url, postData }) {
    record({ url: () => url, postData: () => postData });
}

const results = [];
const pass = (id, msg, detail) => results.push({ id, ok: true, msg, detail });
const fail = (id, msg, detail) => results.push({ id, ok: false, msg, detail });
const skip = (id, msg) => results.push({ id, ok: null, msg });

const log = (s) => console.log(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const since = () => hits.length;
const from = (n) => hits.slice(n);

/**
 * Open a URL in a fresh tab, let the extension work, return the page.
 *
 * Leftover tabs are closed first: every open YouTube tab keeps its own content
 * script with its own OncePerScope, and a storage change or a background nav
 * wakes all of them. Events then arrive from a tab the current scenario never
 * opened, and the assertion reads a label produced by the previous video.
 */
async function visit(url, settleMs = SETTLE_MS) {
    for (const p of ctx.pages()) {
        const u = p.url();
        if (/youtube\.com|netflix\.com/.test(u)) await p.close().catch(() => {});
    }
    const page = await openInBackground(ctx, url);
    await mute(page);
    await wait(settleMs);
    return page;
}

/** Did the extension attach at all? Separates "sent nothing" from "not running". */
const attached = (page) => page.evaluate(() => ({
    sidebar: !!document.querySelector('#vtt-sidebar'),
    onboarding: !!document.querySelector('#vtt-lang-onboarding'),
    status: document.querySelector('#vtt-status')?.textContent?.trim().slice(0, 120) ?? '',
})).catch(() => ({ sidebar: false, onboarding: false, status: '' }));

/** The no_subtitles hit for this window, or undefined. */
const noSubsFrom = (n) => from(n).find((h) => h.name === 'no_subtitles');

/**
 * Assert one label against the condition that produced it. `expect` is the
 * value the real-world condition should yield; `also` accepts alternatives that
 * are legitimate for a documented reason (e.g. a race with the grace timer).
 */
function checkLabel(id, hit, expect, { also = [], what } = {}) {
    if (!hit) { fail(id, `no_subtitles не пришёл (${what}).`); return; }
    const f = hit.params.failure;
    if (f === '' || f === undefined) {
        fail(id, `failure=${f === '' ? '"" (пустая строка)' : 'отсутствует'} — регрессия.`,
            'Это ровно тот баг, который релиз чинит.');
    } else if (!VOCABULARY.includes(String(f))) {
        fail(id, `failure="${f}" вне словаря.`, `Ожидалось одно из: ${VOCABULARY.join(', ')}`);
    } else if (String(f) === expect) {
        pass(id, `failure="${f}" — ровно то, что даёт ${what}`);
    } else if (also.includes(String(f))) {
        pass(id, `failure="${f}" — допустимая альтернатива для ${what}`,
            `Ожидался "${expect}"; "${f}" объясним, но записать стоит.`);
    } else {
        fail(id, `failure="${f}", ожидался "${expect}" (${what}).`,
            'Значение из словаря, но не соответствует условию — ярлык врёт.');
    }
}

// ---------------------------------------------------------------------------
// Extension hygiene: reload the unpacked build, silence the Web Store copy.
// ---------------------------------------------------------------------------
let mgmt = null;
let storeId = null;
let unpackedId = null;

async function prepareExtensions() {
    mgmt = await openInBackground(ctx, 'chrome://extensions/');
    const list = await mgmt.evaluate(() => new Promise((resolve) => {
        chrome.developerPrivate.getExtensionsInfo((xs) => resolve(xs.map((e) => ({
            id: e.id, name: e.name, location: e.location,
            path: e.prettifiedPath ?? null, enabled: e.state === 'ENABLED',
        }))));
    }));
    // By path, never by name: store names change on rebrand, apps/<app>/build does not.
    const unpacked = list.find((e) => e.location === 'UNPACKED' && e.path?.includes('/apps/youtube/build'));
    if (!unpacked) {
        console.error('\nРаспакованная сборка apps/youtube/build не подключена в Chrome.');
        console.error('chrome://extensions → Developer mode → Load unpacked → apps/youtube/build');
        console.error('Найдено:', list.filter((e) => e.location === 'UNPACKED').map((e) => e.path).join(', ') || '(ничего)');
        return false;
    }
    unpackedId = unpacked.id;
    stopWorkerWatch = await watchWorkerNetwork(PORT, unpacked.id, recordWorker).catch((e) => {
        log(`  (перехват воркера не поднялся: ${String(e).split('\n')[0]})`);
        return () => {};
    });
    const store = list.find((e) => e.location === 'FROM_STORE' && e.enabled && e.name.slice(0, 20) === unpacked.name.slice(0, 20));
    const setEnabled = (id, on) => mgmt.evaluate(({ id, on }) => new Promise((r) =>
        chrome.management.setEnabled(id, on, () => r(chrome.runtime.lastError?.message ?? 'ok'))), { id, on });

    if (store && !KEEP_STORE) {
        storeId = store.id;
        log(`выключаю копию из CWS (${store.id}): ${await setEnabled(store.id, false)}`);
    }
    log(`перезагружаю распакованную (${unpacked.id}): ` + await mgmt.evaluate((id) => new Promise((r) =>
        chrome.developerPrivate.reload(id, { failQuietly: true }, () => r(chrome.runtime.lastError?.message ?? 'ok'))), unpacked.id));
    await wait(2500); // the service worker does not come up instantly
    return true;
}

async function restoreExtensions() {
    if (storeId && mgmt) {
        const r = await mgmt.evaluate(({ id, on }) => new Promise((r) =>
            chrome.management.setEnabled(id, on, () => r(chrome.runtime.lastError?.message ?? 'ok'))),
            { id: storeId, on: true }).catch((e) => String(e));
        log(`возвращаю копию из CWS: ${r}`);
    }
}

/**
 * The language pair the extension actually has stored, for cross-checking.
 *
 * Read from a page of the extension itself: chrome://extensions is a browser
 * page whose chrome.storage is NOT the extension's, so reading there silently
 * returns undefined and every pair comparison quietly degrades to "no data".
 */
async function storedPrefs() {
    if (!unpackedId) return null;
    const p = await openInBackground(ctx, `chrome-extension://${unpackedId}/popup.html`);
    try {
        return await p.evaluate(() => new Promise((resolve) => {
            chrome.storage.local.get('lang.v1', (v) => resolve(v?.['lang.v1'] ?? null));
        }));
    } catch {
        return null;
    } finally {
        await p.close().catch(() => {});
    }
}

let failed = 0;
try {
    if (!NO_RELOAD && !(await prepareExtensions())) {
        await browser.close().catch(() => {});
        process.exit(1);
    }

    log('\nПроверка словаря failure (релиз fix/analytics-tracking-quality)');
    log('─'.repeat(64));

    const prefs = await storedPrefs();
    log(`Языковая пара в хранилище: ${prefs ? `${prefs.learning}/${prefs.native}` : '(не задана)'}`);

    // --- C4: recovery. FIRST, before anything opens the breaker. ------------
    if (wanted('C4')) {
        log(`\n[C4] Восстановление после двух 429: ${VIDEOS.recover}#lingogram_http=429:${RETRY_AFTER_S}@2`);
        const n = since();
        const page = await visit(`${VIDEOS.recover}#lingogram_http=429:${RETRY_AFTER_S}@2`);
        const dom = await attached(page);
        const rec = from(n).find((h) => h.name === 'subs_recovered');
        const ns = noSubsFrom(n);
        const loaded = from(n).find((h) => h.name === 'subtitles_loaded');
        if (!dom.sidebar) {
            fail('C4', 'Расширение не встроилось — сайдбара нет.',
                'Проверь, что распакованная сборка включена, а копия из CWS выключена.');
        } else if (ns) {
            fail('C4', `Пришёл no_subtitles (failure="${ns.params.failure}") — восстановления не было.`,
                'Ожидалось: два запроса подделаны, третий проходит, субтитры грузятся.');
        } else if (loaded || rec) {
            // subs_recovered is NOT expected here, and its absence is correct:
            // it keys off hadFailures, which only noteTrackFailure() sets. Two
            // 429s absorbed by the page-script's own retry loop end in ok:true,
            // so the content script never learns a request ever failed. What @N
            // proves is the retry loop itself — the breaker did not latch and
            // subtitles arrived on the third attempt.
            pass('C4', `субтитры доехали после двух 429, no_subtitles нет${rec ? ' (+subs_recovered)' : ''}`,
                'Ретраи внутри page-script поглотили отказы; брейкер не залатал видео.');
        } else {
            skip('C4', 'Ни subtitles_loaded, ни no_subtitles — дорожки, похоже, не грузились вовсе.');
        }
        await page.close().catch(() => {});
        log('    жду сброса кулдауна (35 с)…');
        await wait(35000);
    }

    // --- A: the empty-string regression, on a genuinely caption-free video --
    if (wanted('A1') || wanted('A2')) {
        log(`\n[A] Видео без субтитров: ${NO_CAPTIONS}`);
        const n = since();
        const page = await visit(NO_CAPTIONS);
        const ns = noSubsFrom(n);
        if (!ns) {
            const dom = await attached(page);
            fail('A1', 'no_subtitles не пришёл.',
                `sidebar=${dom.sidebar}, onboarding=${dom.onboarding}. ` +
                `События: ${from(n).map((h) => h.name).join(', ') || '(нет)'}`);
        } else {
            // page-script confirms "no captions" over 8 consecutive polls; if it
            // loses the race to the 7s grace timer, not-attempted is the honest
            // answer (documented in analytics-manual-check.md).
            checkLabel('A1', ns, 'no-tracks', { also: ['not-attempted'], what: 'видео без дорожек' });

            const { learning, native, site } = ns.params;
            if (learning === undefined || native === undefined) {
                fail('A2', 'no_subtitles без learning/native.', JSON.stringify(ns.params));
            } else if (prefs && (learning !== prefs.learning || native !== prefs.native)) {
                fail('A2', `Пара не совпадает с хранилищем: событие ${learning}/${native}, storage ${prefs.learning}/${prefs.native}.`);
            } else {
                pass('A2', `пара на месте и совпадает с хранилищем: ${learning}/${native}`);
            }
            if (site === 'youtube') pass('A3', 'site="youtube" (явный, не фолбэк)');
            else fail('A3', `site="${site}" — ожидался "youtube".`, JSON.stringify(ns.params));
        }
        await page.close().catch(() => {});
    }

    // --- C2: a 2xx with no events is exactly YouTube's "no translation" -----
    if (wanted('C2')) {
        log(`\n[C2] not-offered: ${VIDEOS.notOffer}#lingogram_http=200`);
        const n = since();
        const page = await visit(`${VIDEOS.notOffer}#lingogram_http=200`);
        const ns = noSubsFrom(n);
        const partial = from(n).find((h) => h.name === 'subs_partial');
        if (ns) {
            checkLabel('C2', ns, 'not-offered', { what: 'ответ 200 без events' });
        } else if (partial) {
            const f = partial.params.failure;
            if (f === 'not-offered') pass('C2', `subs_partial с failure="not-offered" (одна дорожка загрузилась)`);
            else fail('C2', `subs_partial с failure="${f}", ожидался "not-offered".`);
        } else {
            skip('C2', 'Ни no_subtitles, ни subs_partial — возможно, обе дорожки загрузились до подделки.');
        }
        await page.close().catch(() => {});
    }

    // --- C3: 403 is a stale signed URL --------------------------------------
    if (wanted('C3')) {
        log(`\n[C3] stale-url: ${VIDEOS.stale}#lingogram_http=403`);
        const n = since();
        const page = await visit(`${VIDEOS.stale}#lingogram_http=403`);
        checkLabel('C3', noSubsFrom(n), 'stale-url', { what: 'ответ 403' });
        await page.close().catch(() => {});
    }

    // --- C1: throttling. Opens the breaker, so C5/C6 ride right behind it ---
    if (wanted('C1') || wanted('C5') || wanted('C6')) {
        log(`\n[C1] rate-limited: ${VIDEOS.limited}#lingogram_http=429:${RETRY_AFTER_S}`);
        const n = since();
        const page = await visit(`${VIDEOS.limited}#lingogram_http=429:${RETRY_AFTER_S}`);
        const ns = noSubsFrom(n);
        checkLabel('C1', ns, 'rate-limited', { what: 'ответ 429' });
        if (ns) {
            if (ns.params.status === 429) pass('C1b', 'status=429 доехал в событие');
            else fail('C1b', `status=${ns.params.status}, ожидался 429.`);
        }
        const rl = from(n).find((h) => h.name === 'subs_rate_limited');
        if (!rl) {
            skip('C1c', 'subs_rate_limited не пришёл.');
        } else if (Number(rl.params.retry_after_s) === RETRY_AFTER_S) {
            pass('C1c', `subs_rate_limited: retry_after_s=${RETRY_AFTER_S} — клиент уважает заголовок сервера`);
        } else {
            fail('C1c', `retry_after_s=${rl.params.retry_after_s}, ожидалось ${RETRY_AFTER_S}.`,
                'Клиент подставил собственный джиттер вместо Retry-After.');
        }
        // The user-visible half: throttling must not read as "no subtitles".
        const dom = await attached(page);
        if (dom.status) log(`    баннер: "${dom.status}"`);

        // C5/C6 must stay in THIS tab: the breaker is `new RateLimitBreaker()`
        // inside the page-script, one instance per tab, so closing the tab
        // throws the cooldown away with it. Navigate the same tab instead —
        // YouTube's SPA keeps the page-script (and its breaker) alive.
        // Same tab, because the breaker is `new RateLimitBreaker()` inside the
        // page-script — one instance per tab, thrown away with it.
        //
        // Measured, not assumed: ytd-app.navigate_() is not callable from an
        // evaluate() (the URL simply does not change), and page.goto() is a full
        // document load that re-injects the page-script with a fresh breaker.
        // Neither route reaches "a DIFFERENT video while the cooldown is open",
        // so C6 stays honest about not being reachable from here — see the
        // report note. What IS proven live is the cooldown's effect: after the
        // breaker opens, retries drop from 4 attempts to 1 (visible in the
        // page-script log as `attempts: 1`).
        const navSame = async (url, settleMs = 25000) => {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
            await wait(settleMs);
        };

        // --- C6 goes FIRST: the breaker's first step is 30s (steps[0]), and C5's
        // own settle would eat most of it. C6 is the check that genuinely needs
        // the window open; C5 only needs it to be irrelevant.
        if (wanted('C6')) {
            log(`\n[C6] Внутри кулдауна — видео с субтитрами: ${VIDEOS.cooldown}`);
            const n6 = since();
            await navSame(VIDEOS.cooldown, 12000);
            const ns6 = noSubsFrom(n6);
            if (!ns6) {
                skip('C6', 'Не воспроизводится из скрипта: перейти на ДРУГОЕ видео, сохранив брейкер, нечем.',
                    'goto пересоздаёт page-script (новый брейкер), ytd-app.navigate_() из evaluate() не работает.');
            } else {
                checkLabel('C6', ns6, 'cooldown', { what: 'запрос внутри кулдауна' });
                if (ns6.params.attempts === 0) pass('C6b', 'attempts=0 — запрос действительно не уходил');
                else fail('C6b', `attempts=${ns6.params.attempts}, ожидался 0.`);
            }
        }

        // --- C5: during the cooldown, a caption-free video is still no-tracks
        if (wanted('C5')) {
            log(`\n[C5] Внутри кулдауна — видео без субтитров: ${NO_CAPTIONS_2}`);
            const n5 = since();
            await navSame(NO_CAPTIONS_2);
            const ns5 = noSubsFrom(n5);
            if (!ns5) skip('C5', 'no_subtitles не пришёл (одноразовость: это видео уже отчитывалось в [A]).');
            else checkLabel('C5', ns5, 'no-tracks', { also: ['not-attempted'], what: 'видео без дорожек внутри кулдауна' });
        }
        await page.close().catch(() => {});
    }

    // --- Human-gated legs ---------------------------------------------------
    if (SKIP_HUMAN) {
        for (const id of ['D1', 'B1', 'B2', 'G1']) skip(id, 'Пропущено (--skip-human).');
    } else {
        // D1: Netflix is the only source of no-language-match — YouTube always
        // falls back to a machine-translation request, so the label is
        // structurally unreachable there.
        if (wanted('D1')) {
            log('\n[D1] Netflix — ярлык no-language-match');
            log('     В окне браузера: открой тайтл на Netflix и выставь в настройках');
            log('     расширения пару языков, которых у этого тайтла НЕТ.');
            const n = since();
            const nf = await openInBackground(ctx, NETFLIX_URL);
            await mute(nf);
            log(`     Открыл ${NETFLIX_URL} в фоновой вкладке.`);
            log(`     Жду ${HUMAN_WAIT / 1000} с…`);
            await wait(HUMAN_WAIT);
            const ns = from(n).find((h) => h.name === 'no_subtitles' && h.params.site === 'netflix');
            if (!ns) {
                skip('D1', 'no_subtitles с site="netflix" не пришёл.',
                    `События за окно: ${from(n).map((h) => h.name).join(', ') || '(нет)'}`);
            } else {
                checkLabel('D1', ns, 'no-language-match', { what: 'пара, которой у тайтла нет' });
                if (ns.params.site === 'netflix') pass('D1b', 'site="netflix" при издании youtube-extension');
            }
        }

        // B: word events, both legs.
        if (wanted('B1') || wanted('B2')) {
            log('\n[B] Сохранение слова');
            log('     Сохрани слово — сначала разлогиненным, потом залогиненным.');
            const n = since();
            const wp = await openInBackground(ctx, VIDEOS.recover);
            await mute(wp);
            log(`     Открыл ${VIDEOS.recover} — субтитры там есть, слово брать оттуда.`);
            log(`     Жду ${WORD_WAIT / 1000} с…`);
            await wait(WORD_WAIT);
            const attempts = from(n).filter((h) => h.name === 'word_save_attempt');
            const saves = from(n).filter((h) => h.name === 'word_saved');
            if (!attempts.length && !saves.length) {
                skip('B1', 'Событий сохранения не было.');
                skip('B2', 'Событий сохранения не было.');
            } else {
                for (const [id, ev, label] of [['B1', attempts[0], 'word_save_attempt'],
                                               ['B2', saves[0], 'word_saved']]) {
                    if (!ev) { skip(id, `${label} не приходил.`); continue; }
                    const miss = ['learning', 'native', 'signed_in'].filter((k) => ev.params[k] === undefined);
                    if (miss.length) {
                        fail(id, `${label} без параметров: ${miss.join(', ')}`, JSON.stringify(ev.params));
                    } else if (prefs && (ev.params.learning !== prefs.learning || ev.params.native !== prefs.native)) {
                        fail(id, `${label}: пара ${ev.params.learning}/${ev.params.native} ≠ storage ${prefs.learning}/${prefs.native}.`,
                            'Фон читает loadLanguagePrefs() — расхождение значит, что он смотрит не туда.');
                    } else {
                        pass(id, `${label}: ${ev.params.learning}/${ev.params.native}, signed_in=${ev.params.signed_in}`);
                    }
                }
                const signedOut = attempts.find((h) => h.params.signed_in === false);
                if (signedOut) pass('B3', 'есть попытка с signed_in=false — разлогиненная нога покрыта');
                else skip('B3', 'Попытки с signed_in=false не было.');
            }
        }

        // G1: REPORT_NO_SUBS must carry the vocabulary even after "Search again"
        // cleared trackFailures — that fallback is what this release added.
        if (wanted('G1')) {
            log('\n[G1] Кнопка «Reload page» — диагностический репорт');
            log('     На баннере «нет субтитров»: нажми «Search again», ДОЖДИСЬ провала,');
            log('     затем «Reload page». Порядок важен: первый клик чистит trackFailures,');
            log('     и репорт обязан упасть на lastNoSubsFailure.');
            const before = commits.length;
            const gp = await openInBackground(ctx, NO_CAPTIONS);
            await mute(gp);
            log(`     Открыл ${NO_CAPTIONS} — баннер «нет субтитров» будет там.`);
            log(`     Жду ${HUMAN_WAIT / 1000} с…`);
            await wait(HUMAN_WAIT);
            const fresh = commits.slice(before);
            const diag = fresh.find((c) => c.fields?.kind?.stringValue === 'no_subs_after_retry');
            if (!diag) {
                skip('G1', 'Диагностический коммит не наблюдался.',
                    'Живой клик почти никогда не успевает: reportNoSubsAndReload() даёт запросу ' +
                    'Promise.race с 400 мс, а спящему MV3-воркеру нужно больше, после чего ' +
                    'location.reload() рвёт его безусловно. Проверять через прямой REPORT_NO_SUBS.');
            } else {
                const f = diag.fields.failure?.stringValue;
                if (!f) fail('G1', 'failure пуст в репорте.', JSON.stringify(Object.keys(diag.fields)));
                else if (!VOCABULARY.includes(f)) fail('G1', `failure="${f}" вне словаря.`);
                else pass('G1', `репорт несёт failure="${f}" после «Search again»`,
                    'Именно это добавил релиз: падение на lastNoSubsFailure.');
            }
        }
    }

    // --- E0: the prod-build tripwire ---------------------------------------
    if (sawProdEndpoint) {
        fail('E0', `Хиты уходили не в dev-свойство: ${sawProdEndpoint}`,
            'Прогон шёл на прод-сборке — эти события неотделимы от реальных данных.');
    } else if (hits.length) {
        pass('E0', `все ${hits.length} хитов ушли в dev-свойство ${DEV_MEASUREMENT_ID} на /debug/mp/collect`);
    } else {
        skip('E0', 'Хитов не было — проверить нечего.');
    }

    // --- anonymity audit over everything captured ---------------------------
    const FORBIDDEN = ['user_id', 'uid', 'email', 'term', 'context', 'text', 'url',
                       'video_id', 'video_ref', 'title'];
    const leaks = [];
    for (const h of hits) {
        for (const k of FORBIDDEN) if (k in h.params) leaks.push(`${h.name}.${k}`);
        if (h.params.site && /\./.test(String(h.params.site))) {
            leaks.push(`${h.name}.site="${h.params.site}" (похоже на hostname)`);
        }
    }

    log('\n' + '─'.repeat(64));
    log('РЕЗУЛЬТАТ\n');
    for (const r of results) {
        const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '·';
        log(`  ${mark} ${r.id}  ${r.msg}`);
        if (r.detail) log(`       ${r.detail}`);
    }

    const noSubs = hits.filter((h) => h.name === 'no_subtitles');
    if (noSubs.length) {
        const byFailure = {};
        for (const h of noSubs) {
            const k = h.params.failure === '' ? '(пусто)' : String(h.params.failure ?? '(нет)');
            byFailure[k] = (byFailure[k] ?? 0) + 1;
        }
        log(`\n  no_subtitles по failure: ${Object.entries(byFailure)
            .map(([k, v]) => `${k}=${v}`).join(', ')}`);
        const empty = noSubs.filter((h) => h.params.failure === '' || h.params.failure === undefined).length;
        log(`  Пустых failure: ${empty}${empty === 0 ? '  ← регрессия не воспроизводится' : '  ← РЕГРЕССИЯ'}`);
    }
    log(`  Всего хитов в GA4: ${hits.length}`);
    log(`  Имена событий: ${[...new Set(hits.map((h) => h.name))].join(', ') || '(нет)'}`);
    log(`  Диагностических коммитов: ${commits.length}`);
    log(`  Утечки приватности: ${leaks.length ? leaks.join(', ') : 'нет'}`);
    if (leaks.length) failed++;

    failed += results.filter((r) => r.ok === false).length;
    log(`\n  ${failed === 0 ? 'Провалов нет.' : `Провалов: ${failed}.`}`);
} finally {
    stopWorkerWatch();
    await restoreExtensions();
    await browser.close().catch(() => {});
}
process.exit(failed === 0 ? 0 : 1);
