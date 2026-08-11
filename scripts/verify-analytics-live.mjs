// Checklist 2.13–2.18 against a real, signed-in Chrome.
//
// Why this exists: an automated Chromium gets `playabilityStatus =
// LOGIN_REQUIRED` ("Sign in to confirm that you're not a bot") from YouTube —
// verified on a clean profile with zero extensions — so captionTracks never
// arrive and none of the subtitle-dependent events can fire. Attaching to a
// browser the user already signed into is the way past that; nothing here
// automates a login or touches credentials.
//
// Usage (the human does the Preparation steps first, see
// docs/analytics-manual-check.md):
//
//   node scripts/verify-analytics-live.mjs                 # full run
//   node scripts/verify-analytics-live.mjs --port 9333
//   node scripts/verify-analytics-live.mjs --only 2.13,2.14
//
// Reads nothing from the profile, writes nothing to it. It drives tabs and
// records the extension's own outgoing GA4 requests.

import { chromium } from '../apps/site/node_modules/playwright-core/index.mjs';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = argOf('--port', '9333');
const ONLY = argOf('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const CAPTIONED = argOf('--video', 'https://www.youtube.com/watch?v=aircAruvnKk');
const CAPTIONED_2 = argOf('--video2', 'https://www.youtube.com/watch?v=8jPQjjsBbIc');
const NO_CAPTIONS = argOf('--nocaps', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');

const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);

let browser;
try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch (e) {
    console.error(`\nНе удалось подключиться к Chrome на порту ${PORT}.`);
    console.error('Запусти Chrome с флагом отладки (шаг «Подготовка»):\n');
    console.error(`  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\`);
    console.error(`    --remote-debugging-port=${PORT} &\n`);
    console.error(String(e).split('\n')[0]);
    process.exit(1);
}

const ctx = browser.contexts()[0];
if (!ctx) {
    console.error('У браузера нет контекста — открыто ли хоть одно окно?');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Collect every GA4 hit the extension makes, from any tab or worker.
// ---------------------------------------------------------------------------
const hits = [];
const record = (req) => {
    const url = req.url();
    if (!/google-analytics\.com/.test(url)) return;
    try {
        const body = JSON.parse(req.postData() ?? '{}');
        for (const e of body.events ?? []) {
            hits.push({ at: Date.now(), name: e.name, params: e.params ?? {} });
        }
    } catch { /* a hit we cannot parse is still not a hit we can assert on */ }
};
ctx.on('request', record);
for (const w of ctx.serviceWorkers?.() ?? []) w.on?.('request', record);
ctx.on('serviceworker', (w) => w.on?.('request', record));

const since = () => hits.length;
const sliceFrom = (n) => hits.slice(n);
const namesFrom = (n) => sliceFrom(n).map((h) => h.name);
const countFrom = (n, name) => namesFrom(n).filter((x) => x === name).length;
const firstFrom = (n, name) => sliceFrom(n).find((h) => h.name === name);

const results = [];
const pass = (id, msg, detail) => results.push({ id, ok: true, msg, detail });
const fail = (id, msg, detail) => results.push({ id, ok: false, msg, detail });
const skip = (id, msg) => results.push({ id, ok: null, msg });

const log = (s) => console.log(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a URL in a fresh tab and give the extension time to do its work. */
async function visit(url, settleMs = 25000) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(settleMs);
    return page;
}

/** Did the extension attach at all? Distinguishes "sent nothing" from "not running". */
async function attached(page) {
    return page.evaluate(() => ({
        sidebar: !!document.querySelector('#vtt-sidebar'),
        banner: !!document.querySelector('#vtt-lang-onboarding'),
        lines: document.querySelectorAll('.vtt-line').length,
    })).catch(() => ({ sidebar: false, banner: false, lines: 0 }));
}

// ---------------------------------------------------------------------------
log('\nПроверка 2.13–2.18 на живом Chrome\n' + '─'.repeat(60));

// --- 2.18 onboarding -> languages_configured -------------------------------
let langPage = null;
if (wanted('2.18')) {
    log('\n[2.18] Первый запуск: онбординг и выбор языков');
    const n = since();
    langPage = await visit(CAPTIONED);
    const dom = await attached(langPage);

    if (!dom.sidebar) {
        fail('2.18', 'Расширение не встроилось в страницу — сайдбара нет.',
            'Проверь: включено ли распакованное расширение и отключена ли копия из CWS.');
    } else if (dom.banner) {
        log('      Баннер выбора языков виден — выбери пару в окне браузера.');
        log('      Жду 45 с…');
        await wait(45000);
        const cfg = firstFrom(n, 'languages_configured');
        if (cfg) {
            pass('2.18', `languages_configured пришёл, via="${cfg.params.via}"`,
                `onboarding_shown: ${countFrom(n, 'onboarding_shown')}`);
        } else {
            fail('2.18', 'languages_configured не пришёл после выбора пары.',
                `События за период: ${namesFrom(n).join(', ') || '(нет)'}`);
        }
    } else {
        // Языки уже выбраны — онбординг не показывается, и это нормально.
        skip('2.18', 'Языковая пара уже настроена, баннер не показывается. ' +
            'Чтобы проверить: удали расширение, установи заново и перезапусти с --only 2.18');
    }
}

// --- 2.13 dual_subs_shown ---------------------------------------------------
if (wanted('2.13')) {
    log('\n[2.13] Двойные субтитры: ровно одно событие на видео');
    const n = since();
    const page = langPage ?? await visit(CAPTIONED);
    if (langPage) await wait(8000);
    const dom = await attached(page);

    const dual = countFrom(n, 'dual_subs_shown');
    const loaded = firstFrom(n, 'subtitles_loaded');

    if (dual === 1) {
        pass('2.13', 'Ровно один dual_subs_shown',
            `track_count=${loaded?.params.track_count}, строк субтитров в DOM: ${dom.lines}`);
    } else if (dual === 0) {
        fail('2.13', 'dual_subs_shown не пришёл.',
            dom.lines === 0
                ? 'Субтитры не загрузились вовсе — возможно, у видео нет второй дорожки, ' +
                  'или YouTube не отдал треки. Попробуй --video с другим роликом.'
                : `Субтитры в DOM есть (${dom.lines} строк), но события нет — это находка.`);
    } else {
        fail('2.13', `dual_subs_shown пришёл ${dual} раза вместо одного.`,
            'Однострел пере-взводится там, где не должен.');
    }
}

// --- 2.14 one-shot survives a manual retry, re-arms on a new video ----------
if (wanted('2.14')) {
    log('\n[2.14] «Search again» не дублирует, смена видео — взводит заново');

    const nRetry = since();
    const pages = ctx.pages();
    const page = pages[pages.length - 1];
    // The sidebar's retry control; ids differ across versions, so try a few.
    const clicked = await page.evaluate(() => {
        const sel = ['#vtt-search-again', '#vtt-retry', '[data-vtt-retry]'];
        for (const s of sel) {
            const el = document.querySelector(s);
            if (el) { el.click(); return s; }
        }
        const byText = [...document.querySelectorAll('#vtt-sidebar button')]
            .find((b) => /search again|искать снова|повтор/i.test(b.textContent ?? ''));
        if (byText) { byText.click(); return 'по тексту кнопки'; }
        return null;
    }).catch(() => null);

    if (!clicked) {
        skip('2.14', 'Кнопку «Search again» не нашёл — нажми её вручную в браузере, ' +
            'затем запусти: node scripts/verify-analytics-live.mjs --only 2.14');
    } else {
        await wait(20000);
        const dupes = countFrom(nRetry, 'dual_subs_shown');
        if (dupes === 0) {
            pass('2.14a', `Ручной ретрай (${clicked}) НЕ пере-взвёл однострел`, 'дублей нет');
        } else {
            fail('2.14a', `После «Search again» пришло ещё ${dupes} dual_subs_shown.`,
                'Сброс однострелов уехал в resetForNewVideo() — он вызывается и на ретрае.');
        }

        const nNew = since();
        await visit(CAPTIONED_2);
        const again = countFrom(nNew, 'dual_subs_shown');
        if (again >= 1) {
            pass('2.14b', 'Настоящая смена видео взвела однострел заново', `событий: ${again}`);
        } else {
            fail('2.14b', 'На новом видео dual_subs_shown не пришёл.',
                `События: ${namesFrom(nNew).join(', ') || '(нет)'} — возможно, у ролика нет двух дорожек.`);
        }
    }
}

// --- 2.17 no_subtitles carries a real reason -------------------------------
if (wanted('2.17')) {
    log('\n[2.17] Видео без субтитров: причина отказа осмысленная');
    const n = since();
    await visit(NO_CAPTIONS, 30000);
    const ev = firstFrom(n, 'no_subtitles');
    if (!ev) {
        fail('2.17', 'no_subtitles не пришёл.',
            `События: ${namesFrom(n).join(', ') || '(нет)'}`);
    } else {
        const f = String(ev.params.failure ?? '');
        if (f && f !== 'unknown') {
            pass('2.17', `failure="${f}"`, `status=${ev.params.status}, attempts=${ev.params.attempts}`);
        } else {
            fail('2.17', `failure="${f || '(пусто)'}" — причина потерялась по дороге.`,
                'Ожидалось значение из VttFailure, например not-offered или unavailable.');
        }
    }
}

// --- 2.15 Netflix ----------------------------------------------------------
if (wanted('2.15')) {
    log('\n[2.15] Netflix: site=netflix при том же ext_source');
    log('      Открой серию с субтитрами в браузере. Жду 60 с…');
    const n = since();
    await ctx.newPage().then((p) =>
        p.goto('https://www.netflix.com/browse', { waitUntil: 'domcontentloaded', timeout: 60000 })
            .catch(() => {}));
    await wait(60000);

    const nf = sliceFrom(n).filter((h) => h.params.site === 'netflix');
    if (nf.length === 0) {
        skip('2.15', 'Событий с site="netflix" не было. Нужна открытая серия с субтитрами — ' +
            'запусти повторно: --only 2.15');
    } else {
        const src = nf[0].params.ext_source;
        if (src === 'youtube-extension') {
            pass('2.15', `site="netflix" при ext_source="${src}"`,
                `события: ${[...new Set(nf.map((h) => h.name))].join(', ')}`);
        } else {
            fail('2.15', `ext_source="${src}", ожидался youtube-extension.`,
                'Netflix живёт внутри youtube-расширения — разрез должен идти по site.');
        }
    }
}

// --- 2.16 Rezka ------------------------------------------------------------
if (wanted('2.16')) {
    log('\n[2.16] Rezka: одна страница — одно событие');
    log('      Открой тайтл с субтитрами. Жду 60 с…');
    const n = since();
    await wait(60000);

    const rz = sliceFrom(n).filter((h) => h.params.site === 'rezka');
    if (rz.length === 0) {
        skip('2.16', 'Событий с site="rezka" не было. Нужны загруженное rezka-расширение ' +
            'и открытый тайтл — запусти повторно: --only 2.16');
    } else {
        const dual = rz.filter((h) => h.name === 'dual_subs_shown').length;
        if (dual <= 1) {
            pass('2.16', `dual_subs_shown: ${dual} (без дублей)`,
                `site="rezka" независимо от зеркала; события: ${[...new Set(rz.map((h) => h.name))].join(', ')}`);
        } else {
            fail('2.16', `dual_subs_shown пришёл ${dual} раз на одну страницу.`,
                'У rezka одна страница = один тайтл, дублей быть не должно.');
        }
    }
}

// ---------------------------------------------------------------------------
// Anonymity audit over everything captured — free, and catches a leak in any
// branch the run happened to touch.
// ---------------------------------------------------------------------------
const FORBIDDEN = ['user_id', 'uid', 'email', 'term', 'context', 'text', 'url',
                   'video_id', 'video_ref', 'title'];
const leaks = [];
for (const h of hits) {
    for (const k of FORBIDDEN) if (k in h.params) leaks.push(`${h.name}.${k}`);
    if (h.params.site && /\./.test(String(h.params.site))) {
        leaks.push(`${h.name}.site="${h.params.site}" (похоже на hostname)`);
    }
}

log('\n' + '─'.repeat(60));
log('РЕЗУЛЬТАТ\n');
for (const r of results) {
    const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '·';
    log(`  ${mark} ${r.id}  ${r.msg}`);
    if (r.detail) log(`       ${r.detail}`);
}

log(`\n  Всего хитов в GA4: ${hits.length}`);
log(`  Имена событий: ${[...new Set(hits.map((h) => h.name))].join(', ') || '(нет)'}`);
log(`  Утечки приватности: ${leaks.length ? leaks.join(', ') : 'нет'}`);

const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
log(`\n  Пройдено ${passed} · провалено ${failed} · пропущено ${skipped}\n`);

// Full dump so a failure can be diagnosed without a second run.
console.log('ПОЛНЫЙ ЛОГ СОБЫТИЙ:');
console.log(JSON.stringify(hits.map(({ name, params }) => ({ name, params })), null, 2));

await browser.close();   // detaches CDP; does NOT close the user's Chrome
process.exit(failed > 0 ? 1 : 0);
