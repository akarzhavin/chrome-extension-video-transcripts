// Capture the panel as it looks in REAL fullscreen, over a REAL video — for the
// promo slide where the product fills the whole screen.
//
//   node capture-fullscreen.mjs
//   node capture-fullscreen.mjs --video <id> --learn es --native en
//   node capture-fullscreen.mjs --theme dark --panel closed
//
// WHY THIS CONNECTS TO A RUNNING CHROME INSTEAD OF LAUNCHING ONE
// (the rule, and the reasoning, live in docs/ops/live-debug-cdp.md):
//
// A launched, automated profile is bot-walled by YouTube. That matters here far
// beyond "no captions": the wall flips the whole #movie_player subtree to
// visibility:hidden, and in fullscreen SidebarUI re-parents the panel INTO
// #movie_player. So the panel inherits the hiding — it lays out at the right
// place (x=1600, 320x1005), reports visibility:visible after a forced override,
// and still never composites into the screenshot. Forcing styles does not fix
// it; using the logged-in browser does, because the wall is never raised.
//
// Two more things this has to get right:
//   1. Entering fullscreen COLLAPSES the sidebar (SidebarUI.applyCollapsed(true),
//      transient by design), so it is re-opened AFTER the transition, not before.
//   2. Fullscreen is gated on a user gesture, so requestFullscreen() rides a real
//      page.mouse.click via a capture-phase listener on document — a listener on
//      #movie_player never fires, because YouTube stacks overlays above it.
//
// UNLIKE every other script in this folder, the tab is deliberately FOREGROUND:
// a background tab cannot enter fullscreen. It therefore takes over the screen
// for ~30s. Audio is muted via the shared helper, and the CWS copy is left
// exactly as it was found (see docs: two extension copies graft into one UI).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../node_modules/playwright-core/index.mjs';
import { mute } from '../../../scripts/lib/cdp-background-tab.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-live');
const UNPACKED_PATH = 'apps/youtube/build';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };

const PORT = arg('port', '9333');
const learn = arg('learn', 'es'), native = arg('native', 'en');
// A talking-head video: the promo frame wants a face and a calm background, not
// a music video's hard cuts. Overridable because "calm" ages.
const video = arg('video', 'l1YFmiOZ7Q4');
const loc = arg('locale', 'en');
const outName = arg('out', `live-fullscreen-${loc}.png`);
const panelOpen = arg('panel', 'open') !== 'closed';
// Dark is the product default and the right look over dark footage; the store
// series uses light, so it stays switchable.
const theme = arg('theme', 'dark');
const W = 1920, H = 1080;

// A tab must exist before Playwright can attach: connectOverCDP fails with
// "Browser context management is not supported" against a browser with zero
// targets (window closed, process still alive — normal on macOS). One HTTP call
// to /json/new fixes it without touching the user's session.
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
if (!targets) {
    console.error(`Chrome на порту ${PORT} не отвечает. Запуск — см. docs/ops/live-debug-cdp.md`);
    process.exit(1);
}
if (!targets.some((t) => t.type === 'page')) {
    console.log('в браузере нет ни одной вкладки — открываю пустую');
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
        .catch(() => fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`));
    await sleep(800);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
let page = null;
let restoreStore = null;

try {
    // Reload the unpacked build: content scripts are cached, and a stale one
    // makes a fresh fix look like it did nothing (docs: the most expensive
    // mistake in this loop). Identify it by PATH — store names change.
    const mgmt = await ctx.newPage();
    await mgmt.goto('chrome://extensions/');
    const info = await mgmt.evaluate(() => new Promise((r) => chrome.developerPrivate.getExtensionsInfo({}, r)));
    const unpacked = info.find((e) => e.location === 'UNPACKED' && (e.prettifiedPath || '').includes(UNPACKED_PATH));
    if (!unpacked) throw new Error(`распакованная сборка ${UNPACKED_PATH} не найдена в этом профиле`);
    await mgmt.evaluate((id) => new Promise((r) =>
        chrome.developerPrivate.reload(id, { failQuietly: true }, r)), unpacked.id);
    console.log(`перезагрузил распакованную (${unpacked.id.slice(0, 8)}…): ok`);

    // The CWS copy answers the same postMessage protocol and shares the #vtt-*
    // ids, so both painting at once yields a spliced UI. Disable only if it is
    // actually enabled, and restore whatever we found in finally.
    const store = info.find((e) => e.location === 'FROM_STORE' && /Lingogram/i.test(e.name) && /YouTube/i.test(e.name));
    if (store && store.state === 'ENABLED') {
        await mgmt.evaluate(({ id }) => new Promise((r) => chrome.management.setEnabled(id, false, r)), { id: store.id });
        restoreStore = store.id;
        console.log(`выключил копию из CWS (${store.id.slice(0, 8)}…): ok`);
    }
    await mgmt.close();
    await sleep(1500);

    // Foreground tab — fullscreen needs it. This is the one script that steals focus.
    page = await ctx.newPage();
    await page.setViewportSize({ width: W, height: H });
    console.log('открываю видео (вкладка выйдет на передний план ~30 с)');
    await page.goto(`https://www.youtube.com/watch?v=${video}#vtt-demo?learn=${learn}&native=${native}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(' ', await mute(page));
    await page.waitForSelector('#vtt-list .vtt-item', { timeout: 40000 }).catch(() => {});
    if (theme === 'light') await page.evaluate(() => document.documentElement.classList.add('vtt-light'));
    await sleep(2500);

    // Hide YouTube's own chrome so the frame reads as clean video, and keep it
    // hidden: the player re-shows it on mouse move and on state changes.
    await page.evaluate(() => {
        const hide = () => document.querySelectorAll(
            '.ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom, .ytp-gradient-top, .ytp-ce-element')
            .forEach((e) => e.style.setProperty('opacity', '0', 'important'));
        hide(); if (!window.__lgChromeTimer) window.__lgChromeTimer = setInterval(hide, 500);
    });

    page.on('console', (m) => { if (m.text().startsWith('LG-FS')) console.log('  ' + m.text()); });
    // requestFullscreen is refused on a tab that is not the active one, so the
    // tab is raised explicitly — ctx.newPage() alone does not guarantee it in a
    // window the user (or a previous run) left focused elsewhere.
    const raise = await ctx.newCDPSession(page);
    await raise.send('Page.bringToFront').catch(() => {});
    await sleep(800);

    // YouTube's own fullscreen button is the most reliable route: it is a real
    // control, already wired to the player, and immune to overlay stacking.
    // The scripted requestFullscreen stays as the fallback.
    let fs = false;
    const fsBtn = page.locator('.ytp-fullscreen-button').first();
    if (await fsBtn.count().catch(() => 0)) {
        await fsBtn.click({ force: true, timeout: 5000 }).catch(() => {});
        await sleep(2500);
        fs = await page.evaluate(() => !!document.fullscreenElement);
    }
    if (!fs) {
        await page.evaluate(() => {
            document.addEventListener('click', () => {
                document.querySelector('#movie_player')?.requestFullscreen?.().then(
                    () => console.log('LG-FS: granted'),
                    (e) => console.log(`LG-FS: refused (${e.name}: ${e.message})`));
            }, { once: true, capture: true });
        });
        const box = await page.locator('#movie_player').boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(3000);
        fs = await page.evaluate(() => !!document.fullscreenElement);
    }
    if (!fs) throw new Error('fullscreen не включился — снимок показал бы оконную раскладку, не полноэкранную');
    console.log('  fullscreen: yes');

    // Re-fire demo mode so updateOverlay() re-parents #vtt-video-overlay onto the
    // now-fullscreen player; otherwise the dual lines stay on the old node.
    await page.evaluate((a) => window.postMessage(
        { __lingogram: 'demo', state: { mode: 'sidebar', learn: a.l, native: a.n } }, '*'), { l: learn, n: native });
    await sleep(2500);

    if (panelOpen) {
        await page.evaluate(() => {
            const s = document.getElementById('vtt-sidebar');
            if (s?.classList.contains('collapsed')) document.getElementById('vtt-toggle-btn')?.click();
        });
        await sleep(2000);
    }

    const st = await page.evaluate(() => {
        const s = document.getElementById('vtt-sidebar');
        const cs = s && getComputedStyle(s);
        const r = s && s.getBoundingClientRect();
        return {
            overlay: !!document.getElementById('vtt-video-overlay'),
            lines: document.querySelectorAll('#vtt-video-overlay *').length,
            fsClass: s?.classList.contains('fullscreen'),
            open: s && !s.classList.contains('collapsed'),
            painted: !!cs && cs.visibility === 'visible' && cs.display !== 'none' && r.width > 0,
            rect: r && { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) },
        };
    });
    console.log(`  overlay:${st.overlay} panel-open:${st.open} fullscreen-class:${st.fsClass}`
        + ` painted:${st.painted} rect:${JSON.stringify(st.rect)}`);
    if (panelOpen && !st.painted) throw new Error('панель открыта, но не отрисована — снимок был бы пустым кадром');

    // Captured over CDP: page.screenshot() re-renders the page viewport, which
    // does NOT include the separately composited fullscreen layer.
    const cdp = await ctx.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT, outName), Buffer.from(data, 'base64'));
    console.log('✓', outName);
} finally {
    if (page) await page.evaluate(() => document.exitFullscreen?.()).catch(() => {});
    if (page) await page.close().catch(() => {});
    if (restoreStore) {
        const m = await ctx.newPage();
        await m.goto('chrome://extensions/').catch(() => {});
        await m.evaluate(({ id }) => new Promise((r) => chrome.management.setEnabled(id, true, r)),
            { id: restoreStore }).catch(() => {});
        await m.close().catch(() => {});
        console.log('вернул копию из CWS: ok');
    }
    await browser.close().catch(() => {});
}
