// Живой прогон по ленте Shorts: листаем ролики, пока субтитры не сломаются.
//
// Зачем отдельно от live-subs-check.mjs: тот проверяет ОДНО видео по URL. Для
// Shorts заранее неизвестно, на каком ролике вылезет дефект — нужна лента и
// переключение до первой ошибки. Всё остальное (фоновая вкладка, mute, глушение
// магазинной копии, reload распакованной) — то же самое и по тем же причинам,
// см. docs/ops/live-debug-cdp.md.
//
// Что считаем ошибкой на конкретном ролике:
//   • failed: <класс> из закрытого словаря timedtext-fetch.ts;
//   • дорожки найдены (caption tracks), но ни одна не распарсилась за окно.
// Ролик без дорожек вообще — НЕ ошибка: у Shorts их часто просто нет, и
// останавливаться на таком значит отлаживать норму (см. no-subtitles-not-breakage).
//
// Переключение — клавишей ArrowDown по документу: это тот же путь, которым
// листает человек, поэтому он гоняет ровно ту навигацию (yt-navigate-finish +
// смена player response), на которой дефекты Shorts и живут.
//
// Usage:
//   node scripts/live-shorts-walk.mjs
//   node scripts/live-shorts-walk.mjs --max 30 --per 12000
//   node scripts/live-shorts-walk.mjs --start https://www.youtube.com/shorts/<id>
//   node scripts/live-shorts-walk.mjs --keep-going   # не вставать на первой ошибке

import { chromium } from '../node_modules/playwright-core/index.mjs';
import { openInBackground, mute } from './lib/cdp-background-tab.mjs';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (flag) => argv.includes(flag);

const PORT = argOf('--port', '9333');
const START = argOf('--start', 'https://www.youtube.com/shorts/');
const MAX = Number(argOf('--max', '25'));       // сколько роликов пролистать
const PER_MS = Number(argOf('--per', '11000')); // сколько слушать каждый
const KEEP_GOING = hasFlag('--keep-going');
const KEEP_STORE = hasFlag('--keep-store');
const WITH_SOUND = hasFlag('--with-sound');

const TAG = '[YT-VTT]';

let browser;
try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch (e) {
    console.error(`\nНе удалось подключиться к Chrome на порту ${PORT}.`);
    console.error('Chrome должен быть запущен с портом отладки:\n');
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

const mgmt = await openInBackground(ctx, 'chrome://extensions/');

const allExtensions = () => mgmt.evaluate(() => new Promise((resolve) => {
    chrome.developerPrivate.getExtensionsInfo((list) => resolve(
        list.map((e) => ({
            id: e.id,
            name: e.name,
            location: e.location,
            path: e.prettifiedPath ?? null,
            enabled: e.state === 'ENABLED',
        })),
    ));
}));

const setEnabled = (id, on) => mgmt.evaluate(
    ({ id, on }) => new Promise((r) => chrome.management.setEnabled(
        id, on, () => r(chrome.runtime.lastError?.message ?? 'ok'),
    )),
    { id, on },
);

const reload = (id) => mgmt.evaluate(
    (id) => new Promise((r) => chrome.developerPrivate.reload(
        id, { failQuietly: true }, () => r(chrome.runtime.lastError?.message ?? 'ok'),
    )),
    id,
);

const extensions = await allExtensions();
const unpacked = extensions.find(
    (e) => e.location === 'UNPACKED' && e.path?.includes('/apps/youtube/build'),
);
const store = extensions.find(
    (e) => e.location === 'FROM_STORE' && e.enabled
        && unpacked && e.name.slice(0, 20) === unpacked.name.slice(0, 20),
);

if (!unpacked) {
    console.error('\nРаспакованная сборка apps/youtube/build не подключена в Chrome.');
    console.error('chrome://extensions → Developer mode → Load unpacked → apps/youtube/build');
    await browser.close();
    process.exit(1);
}

let exitCode = 0;
const report = [];

try {
    if (store && !KEEP_STORE) {
        console.log(`выключаю копию из CWS (${store.id}):`, await setEnabled(store.id, false));
    }
    console.log(`перезагружаю распакованную (${unpacked.id}):`, await reload(unpacked.id));
    await mgmt.waitForTimeout(2000);

    console.log(`открываю ленту Shorts в фоне, до ${MAX} роликов по ${Math.round(PER_MS / 1000)} с\n`);
    const page = await openInBackground(ctx, START);

    // Лог собираем в один буфер, а нарезаем по роликам сами: контент-скрипт
    // живёт через всю SPA-навигацию, и console-события не размечены по видео.
    let buf = [];
    page.on('console', (m) => {
        const t = m.text();
        if (t.includes(TAG)) buf.push(t);
    });

    if (!WITH_SOUND) console.log('  ', await mute(page), '\n');

    const currentId = () => page.evaluate(() => {
        const m = location.pathname.match(/^\/shorts\/([^/?#]+)/);
        return m ? m[1] : null;
    }).catch(() => null);

    // Читаем ровно то, на чём стоит nativeCcState(): нативный CC-контрол. Это и
    // есть сигнал «субтитры у ролика есть» — тот, из-за которого затевался
    // subs_missed_with_cc.
    const ccProbe = () => page.evaluate(() => {
        const isUnavailable = (el) => /unavailable|недоступн|недосту?пні/i
            .test(el.getAttribute('aria-label') || '');
        const shorts = document.querySelector('.ytmClosedCaptioningButtonButton');
        const std = document.querySelector('.ytp-subtitles-button');
        const tracks = (() => {
            for (const id of ['movie_player', 'shorts-player']) {
                const pr = document.getElementById(id)?.getPlayerResponse?.();
                const t = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (t?.length) return t.map((x) => x.languageCode);
            }
            return [];
        })();
        return {
            shortsBtn: shorts ? (isUnavailable(shorts) ? 'unavailable' : 'usable') : 'absent',
            stdBtn: std ? (isUnavailable(std) ? 'unavailable' : 'usable') : 'absent',
            tracks,
        };
    }).catch(() => null);

    const seen = new Set();

    for (let i = 1; i <= MAX; i++) {
        buf = [];
        await page.waitForTimeout(PER_MS);

        const id = await currentId();
        const cc = await ccProbe();
        const key = id ?? `#${i}`;
        if (seen.has(key)) {
            // Лента не продвинулась (конец списка / фокус ушёл) — дальше листать
            // бессмысленно, иначе намеряем один и тот же ролик MAX раз.
            console.log(`\n[${i}] ${key} — лента не продвинулась, останавливаюсь`);
            break;
        }
        seen.add(key);

        const tracksFound = buf.some((l) => l.includes('caption tracks for'));
        const parsed = buf.filter((l) => l.includes('parsed subs:') && !l.includes('parsed subs: 0'));
        const failed = buf.filter((l) => l.includes('failed'));

        // «Дорожек нет» — норма для Shorts, а не дефект. Ошибкой считаем только
        // явный отказ, либо найденные дорожки, которые так и не доехали.
        const broken = failed.length > 0 || (tracksFound && parsed.length === 0);
        const ccSaysYes = cc && (cc.shortsBtn === 'usable' || cc.stdBtn === 'usable');

        const mark = broken ? '✗' : (parsed.length ? '✓' : '·');
        console.log(`[${i}] ${mark} ${key}  cc:{shorts:${cc?.shortsBtn}, std:${cc?.stdBtn}} ` +
                    `tracks:[${cc?.tracks.join(',') || '—'}] parsed:${parsed.length} failed:${failed.length}`);

        report.push({ i, id: key, cc, parsed: parsed.length, failed: failed.length, broken });

        if (broken || (ccSaysYes && parsed.length === 0)) {
            console.log('\n' + '─'.repeat(60));
            console.log(broken ? '  ✗ СЛОМАЛОСЬ' : '  ✗ CC говорит «субтитры есть», а мы ничего не показали');
            console.log(`  ролик: https://www.youtube.com/shorts/${key}`);
            console.log('  лог этого ролика:');
            for (const l of buf) console.log('    ', l);
            console.log('  проба CC:', JSON.stringify(cc));
            exitCode = 1;
            if (!KEEP_GOING) break;
        }

        // Следующий ролик. keyboard.press по документу — тот же путь, которым
        // листает человек.
        await page.keyboard.press('ArrowDown').catch(() => {});
    }

    await page.close();

    console.log('\n' + '─'.repeat(60));
    const bad = report.filter((r) => r.broken);
    console.log(`  роликов пройдено: ${report.length} · с субтитрами: ` +
                `${report.filter((r) => r.parsed > 0).length} · сломалось: ${bad.length}`);
    if (!bad.length && exitCode === 0) console.log('  ✓ до ошибки не дошли');
} finally {
    if (store && !KEEP_STORE) {
        // Обязательно в finally: иначе человек останется с выключенным
        // расширением после падения скрипта.
        console.log('возвращаю копию из CWS:', await setEnabled(store.id, true));
    }
    await mgmt.close().catch(() => {});
    await browser.close().catch(() => {});
}

process.exit(exitCode);
