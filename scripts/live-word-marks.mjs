// Какие классы реально висят на слове субтитров под открытой карточкой.
//
// Зачем: скриншот показал слово с тёмной плашкой и обводкой — формой капсулы
// guess-режима — при том, что режим угадывания был выключен. По коду так быть
// не может: плашку рисуют три правила, все для .vtt-masked-word. Значит либо
// режим всё-таки был guess, либо спан остался masked после переключения режима.
// Различить это из исходников нельзя — только спросив живой DOM.
//
// Почему не chromium.launch(): свежему автоматизированному профилю YouTube не
// отдаёт субтитры (200 с пустым телом), а без субтитров спрашивать нечего.
// См. docs/ops/live-debug-cdp.md.
//
// Вкладка открывается в ФОНЕ и глушится; магазинная копия выключается на время
// прогона и возвращается в finally — всё по трём правилам того же документа.
//
// Usage:
//   node scripts/live-word-marks.mjs
//   node scripts/live-word-marks.mjs --video <url> --wait 60000

import { chromium } from '../node_modules/playwright-core/index.mjs';
import { openInBackground, mute } from './lib/cdp-background-tab.mjs';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = argOf('--port', '9333');
const APP = argOf('--app', 'youtube');
const VIDEO = argOf('--video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const WAIT_MS = Number(argOf('--wait', '45000'));

let browser;
try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch (e) {
    console.error(`Не удалось подключиться к Chrome на порту ${PORT}.`);
    console.error(String(e).split('\n')[0]);
    process.exit(1);
}

const ctx = browser.contexts()[0];
if (!ctx) {
    console.error('У браузера нет контекста — открыто ли окно?');
    process.exit(1);
}

const mgmt = await openInBackground(ctx, 'chrome://extensions/');

const allExtensions = () => mgmt.evaluate(() => new Promise((resolve) => {
    chrome.developerPrivate.getExtensionsInfo((list) => resolve(
        list.map((e) => ({
            id: e.id, name: e.name, location: e.location,
            path: e.prettifiedPath ?? null, enabled: e.state === 'ENABLED',
        })),
    ));
}));
const setEnabled = (id, on) => mgmt.evaluate(
    ({ id, on }) => new Promise((r) => chrome.management.setEnabled(
        id, on, () => r(chrome.runtime.lastError?.message ?? 'ok'))), { id, on });
const reload = (id) => mgmt.evaluate(
    (id) => new Promise((r) => chrome.developerPrivate.reload(
        id, { failQuietly: true }, () => r(chrome.runtime.lastError?.message ?? 'ok'))), id);

const extensions = await allExtensions();
const unpacked = extensions.find(
    (e) => e.location === 'UNPACKED' && e.path?.includes(`/apps/${APP}/build`));
const store = extensions.find(
    (e) => e.location === 'FROM_STORE' && e.enabled
        && unpacked && e.name.slice(0, 20) === unpacked.name.slice(0, 20));

if (!unpacked) {
    console.error(`Распакованная сборка apps/${APP}/build не подключена.`);
    await browser.close();
    process.exit(1);
}

let page;
try {
    if (store) console.log('выключаю копию из CWS:', await setEnabled(store.id, false));
    console.log('перезагружаю распакованную:', await reload(unpacked.id));
    await mgmt.waitForTimeout(1200);

    console.log(`открываю ${VIDEO} в фоне, жду субтитры до ${WAIT_MS / 1000} с`);
    page = await openInBackground(ctx, VIDEO);
    page.on('console', (m) => {
        const t = m.text();
        if (t.includes('[YT-VTT]')) console.log('  ', t.slice(0, 150));
    });
    await mute(page);

    // Ждём, пока в оверлее появятся слова.
    const deadline = Date.now() + WAIT_MS;
    let ready = false;
    while (Date.now() < deadline) {
        ready = await page.evaluate(() =>
            !!document.querySelector('#vtt-video-overlay .vtt-overlay-main span[data-word], '
                + '#vtt-video-overlay .vtt-overlay-main .vtt-masked-word')).catch(() => false);
        if (ready) break;
        await page.waitForTimeout(1000);
    }
    if (!ready) {
        console.log('\nСлова в оверлее не появились — субтитры не доехали или пара языков не выбрана.');
        process.exitCode = 1;
    } else {
        // Снимок ДО наведения: в каком режиме строка и как одеты слова.
        const before = await page.evaluate(() => {
            const main = document.querySelector('#vtt-video-overlay .vtt-overlay-main');
            const spans = [...main.querySelectorAll('span')];
            return {
                mode: {
                    maskedInOverlay: main.querySelectorAll('.vtt-masked-word').length,
                    revealedInOverlay: main.querySelectorAll('.vtt-revealed-word').length,
                    plainWords: main.querySelectorAll('span[data-word]:not([class])').length,
                },
                words: spans.slice(0, 12).map((s) => ({
                    text: (s.textContent || '').slice(0, 20),
                    cls: s.className || '(none)',
                    hasWord: !!s.dataset.word,
                    hasHidden: !!s.dataset.hidden,
                })),
            };
        });
        console.log('\n── строка ДО наведения ──');
        console.log('   режим:', JSON.stringify(before.mode));
        for (const w of before.words) {
            console.log(`   "${w.text}" cls=[${w.cls}] data-word=${w.hasWord} data-hidden=${w.hasHidden}`);
        }

        // Наводимся на самое длинное слово и ждём карточку.
        const hovered = await page.evaluate(() => {
            const main = document.querySelector('#vtt-video-overlay .vtt-overlay-main');
            const spans = [...main.querySelectorAll('span')]
                .filter((s) => (s.textContent || '').trim().length > 3);
            const target = spans.sort((a, b) =>
                (b.textContent || '').length - (a.textContent || '').length)[0];
            if (!target) return null;
            const r = target.getBoundingClientRect();
            return { text: target.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });

        if (!hovered) {
            console.log('\nНе нашёл слова длиннее 3 символов для наведения.');
        } else {
            console.log(`\nнавожусь на "${hovered.text}"`);
            await page.mouse.move(hovered.x, hovered.y);
            await page.waitForTimeout(1600);

            const after = await page.evaluate(() => {
                const el = document.querySelector('#vtt-video-overlay .vtt-lookup-hit')
                    ?? document.querySelector('#vtt-video-overlay .vtt-peeked-word');
                if (!el) return { found: false, cardOpen: !!document.getElementById('lingogram-lookup-strip') };
                const cs = getComputedStyle(el);
                const after = getComputedStyle(el, '::after');
                return {
                    found: true,
                    cardOpen: !!document.getElementById('lingogram-lookup-strip'),
                    text: (el.textContent || '').slice(0, 24),
                    cls: el.className,
                    dataWord: el.dataset.word ?? null,
                    dataHidden: el.dataset.hidden ?? null,
                    background: cs.backgroundColor,
                    boxShadow: cs.boxShadow.slice(0, 90),
                    bar: { w: after.width, h: after.height, bg: after.backgroundColor },
                };
            });
            console.log('\n── слово ПОД карточкой ──');
            console.log(JSON.stringify(after, null, 1));
        }
    }
} finally {
    await page?.close().catch(() => {});
    // Восстановление ДО закрытия mgmt: setEnabled ходит через эту вкладку, и
    // закрыв её раньше, мы оставили бы человека с выключенным расширением.
    if (store) console.log('возвращаю копию из CWS:', await setEnabled(store.id, true).catch(() => 'FAILED'));
    await mgmt.close().catch(() => {});
    await browser.close().catch(() => {});
}
