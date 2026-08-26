// Живая проверка загрузки субтитров в настоящем Chrome пользователя.
//
// Зачем отдельно от verify-analytics-live.mjs: тот смотрит на GA4-хиты, а этот —
// на сам продукт: доехали ли субтитры до оверлея. Нужен всякий раз, когда
// YouTube/Netflix меняет протокол получения дорожек (последний случай — снятый
// параметр `pot`, август 2026), потому что юнит-тесты такое поймать не могут:
// они мокают fetch, а ломается именно живой контракт с площадкой.
//
// Почему НЕ chromium.launch(): свежему автоматизированному профилю YouTube не
// отдаёт субтитры. timedtext отвечает HTTP 200 с ПУСТЫМ телом (а /player —
// `LOGIN_REQUIRED`), даже по свежеподписанному URL из getPlayerResponse(). Код
// при этом рабочий — проверка врёт. Поэтому подключаемся по CDP к Chrome, где
// человек залогинен. См. docs/live-debug-cdp.md.
//
// Что делает сам, без человека:
//   1. находит распакованную и магазинную копии расширения (по пути на диске);
//   2. выключает магазинную — обе отвечают на один протокол и портят картину;
//   3. перезагружает распакованную, чтобы подхватить свежий build/;
//   4. открывает видео, слушает консоль страницы;
//   5. возвращает магазинной копии исходное состояние в finally.
//
// Профиль не читается и не меняется (кроме п.2, который откатывается).
//
// Usage:
//   node scripts/live-subs-check.mjs
//   node scripts/live-subs-check.mjs --video <url> --wait 60000
//   node scripts/live-subs-check.mjs --app rezka --video <url>
//   node scripts/live-subs-check.mjs --keep-store    # не трогать копию из CWS
//   node scripts/live-subs-check.mjs --with-sound    # не глушить видео
//
// Вкладки открываются в ФОНЕ и видео глушится: прогон идёт в браузере, за
// которым человек работает, и красть у него фокус и звук нельзя.

import { chromium } from '../node_modules/playwright-core/index.mjs';
import { openInBackground, mute } from './lib/cdp-background-tab.mjs';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (flag) => argv.includes(flag);

const PORT = argOf('--port', '9333');
const APP = argOf('--app', 'youtube');            // youtube | rezka
const VIDEO = argOf('--video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const WAIT_MS = Number(argOf('--wait', '40000'));
const KEEP_STORE = hasFlag('--keep-store');
const WITH_SOUND = hasFlag('--with-sound');

// Оба издания логируют под своим тегом; берём строки только от расширения.
const TAG = APP === 'rezka' ? '[REZKA-VTT]' : '[YT-VTT]';

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

// ctx.newPage() создаёт вкладку активной: Chrome поднимает своё окно на
// передний план и на macOS отбирает фокус у того, чем человек занят. CDP
// Target.createTarget с background: true открывает ту же вкладку, не трогая
// ни фокус, ни z-order окна. Окно остаётся видимым — просто не всплывает.
// chrome://extensions — единственная страница, где доступны chrome.management и
// chrome.developerPrivate. Обычная вкладка их не видит.
const mgmt = await openInBackground(ctx, 'chrome://extensions/');

const allExtensions = () => mgmt.evaluate(() => new Promise((resolve) => {
    chrome.developerPrivate.getExtensionsInfo((list) => resolve(
        list.map((e) => ({
            id: e.id,
            name: e.name,
            location: e.location,          // UNPACKED | FROM_STORE
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

// Контент-скрипты кэшируются: без reload вкладка получит ПРОШЛУЮ сборку, и
// правка будет выглядеть как «не помогло». Самая дорогая ошибка в этом цикле.
const reload = (id) => mgmt.evaluate(
    (id) => new Promise((r) => chrome.developerPrivate.reload(
        id, { failQuietly: true }, () => r(chrome.runtime.lastError?.message ?? 'ok'),
    )),
    id,
);

const extensions = await allExtensions();
// Издание опознаём по пути на диске (apps/<app>/build), а не по имени: имена в
// сторе меняются при ребрендинге, путь — нет.
const unpacked = extensions.find(
    (e) => e.location === 'UNPACKED' && e.path?.includes(`/apps/${APP}/build`),
);
// Магазинную копию того же издания ищем по имени, у неё пути нет. Совпадение
// первых слов достаточно: издания названы по-разному (YouTube vs HDrezka).
const store = extensions.find(
    (e) => e.location === 'FROM_STORE' && e.enabled
        && unpacked && e.name.slice(0, 20) === unpacked.name.slice(0, 20),
);

if (!unpacked) {
    console.error(`\nРаспакованная сборка apps/${APP}/build не подключена в Chrome.`);
    console.error('chrome://extensions → Developer mode → Load unpacked → ' +
                  `apps/${APP}/build\n`);
    console.error('Найдено:', extensions.filter((e) => e.location === 'UNPACKED')
        .map((e) => e.path).join(', ') || '(ни одной распакованной)');
    await browser.close();
    process.exit(1);
}

const lines = [];
let exitCode = 1;

try {
    if (store && !KEEP_STORE) {
        // Две копии делят DOM-идентификаторы `#vtt-*` и обе отвечают на один и
        // тот же postMessage-протокол: получается склеенный интерфейс и чужие
        // результаты в логе. Симптом ни на что не похож и съедает время.
        console.log(`выключаю копию из CWS (${store.id}):`, await setEnabled(store.id, false));
    } else if (store) {
        console.log(`копия из CWS оставлена включённой (--keep-store) — лог может быть смешанным`);
    }

    console.log(`перезагружаю распакованную (${unpacked.id}):`, await reload(unpacked.id));
    await mgmt.waitForTimeout(2000);   // service worker поднимается не мгновенно

    console.log(`открываю ${VIDEO} в фоне, слушаю ${Math.round(WAIT_MS / 1000)} с\n`);
    const page = await openInBackground(ctx, VIDEO);
    page.on('console', (m) => {
        const t = m.text();
        if (t.includes(TAG)) {
            lines.push(t);
            console.log('  ', t);
        }
    });

    if (!WITH_SOUND) console.log('  ', await mute(page));

    await page.waitForTimeout(WAIT_MS);
    await page.close();

    // Единственный признак успеха, который нельзя подделать: пришли байты и
    // они распарсились в реплики. «Дорожки найдены» — ещё не субтитры.
    const fetched = lines.filter((l) => l.includes('VTT_RESULT <-') && l.includes('bytes:'));
    const parsed = lines.filter((l) => l.includes('parsed subs:') && !l.includes('parsed subs: 0'));
    const failed = lines.filter((l) => l.includes('failed'));

    console.log('\n' + '─'.repeat(60));
    console.log(`  дорожек загружено: ${fetched.length}`);
    console.log(`  распарсилось     : ${parsed.length}`);
    console.log(`  отказов          : ${failed.length}`);
    if (failed.length) for (const f of failed) console.log(`     ✗ ${f}`);

    exitCode = parsed.length > 0 && failed.length === 0 ? 0 : 1;
    console.log(exitCode === 0
        ? '\n  ✓ PASS — субтитры доехали\n'
        : '\n  ✗ FAIL — субтитры не загрузились\n');

    if (exitCode !== 0 && lines.length === 0) {
        console.log('  В консоли нет ни строчки от расширения. Обычно это значит,');
        console.log('  что оно не встроилось: не тот URL, либо сборка не собрана');
        console.log(`  (npm --prefix apps/${APP} run build:dev).\n`);
    }
} finally {
    if (store && !KEEP_STORE) {
        console.log('возвращаю копию из CWS:', await setEnabled(store.id, true));
    }
    await mgmt.close();
    await browser.close();   // отсоединяет CDP; Chrome пользователя НЕ закрывает
}

process.exit(exitCode);
