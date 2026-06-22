// Capture ONE localized screenshot on a real YouTube page, against an already
// running Chrome (started with the desired --lang and the unpacked extension
// installed). Connects over CDP — does NOT launch Chrome itself, because
// Chrome 138+ ignores --load-extension, so the extension must be installed by
// hand once into a persistent --user-data-dir, then Chrome relaunched per
// locale with --lang. See run-all.sh for the orchestration.
//
//   node capture-live.mjs --scene onboarding --lang de --video dQw4w9WgXcQ
//   node capture-live.mjs --scene sidebar --lang de --learn es --native en --video dQw4w9WgXcQ
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out-live');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };

const scene = arg('scene', 'onboarding');
const lang = arg('lang', 'en');
const video = arg('video', 'dQw4w9WgXcQ');
const learn = arg('learn', 'es');
const native = arg('native', 'en');
const port = arg('port', '9222');

const browser = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });

async function extensionId() {
  const ext = await browser.newPage();
  await ext.goto('chrome://extensions/');
  await sleep(600);
  const id = await ext.evaluate(() => {
    const list = document.querySelector('extensions-manager')?.shadowRoot.querySelector('extensions-item-list');
    const cards = [...(list?.shadowRoot.querySelectorAll('extensions-item') || [])];
    const me = cards.find((c) => /youtube|lingogram/i.test(c.shadowRoot.querySelector('#name')?.textContent || ''));
    return me?.id || null;
  });
  await ext.close();
  return id;
}

const id = await extensionId();
if (!id) { console.error('extension not found in chrome://extensions'); process.exit(1); }

// Control the scene via the extension popup page (has chrome.storage access).
const pop = await browser.newPage();
await pop.goto(`chrome-extension://${id}/popup.html`);
await pop.evaluate(async (s, l, n) => {
  // onboarding needs NO prefs (first-run gate); sidebar/nosubs need prefs set.
  if (s === 'onboarding') await chrome.storage.local.remove('lang.v1');
  else await chrome.storage.local.set({ 'lang.v1': { learning: l, native: n } });
}, scene, learn, native);
const ui = await pop.evaluate(() => chrome.i18n.getUILanguage());
await pop.close();
console.log(`extension id=${id}  UI=${ui}  scene=${scene}`);

let page = (await browser.pages()).find((p) => p.url().includes('/watch'));
if (!page) page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.setCookie(
  { name: 'SOCS', value: 'CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com' },
  { name: 'CONSENT', value: 'YES+cb', domain: '.youtube.com' },
);
await page.bringToFront();

// For the "No subtitles" scene: let the extension detect caption tracks but
// block the actual subtitle (timedtext) fetch, so after the grace period it
// deterministically shows the no-subtitles banner — works on any video.
if (scene === 'nosubs') {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/\/api\/timedtext/.test(req.url())) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

await page.goto(`https://www.youtube.com/watch?v=${video}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#vtt-sidebar', { timeout: 30000 });

let ok = false;
if (scene === 'onboarding') {
  ok = await page.waitForSelector('#vtt-lang-onboarding', { timeout: 15000 }).then(() => true).catch(() => false);
} else if (scene === 'nosubs') {
  // The "No subtitles available" banner is the only one with a Search-again
  // action button (the transient "Searching…" banner has none).
  ok = await page.waitForSelector('#vtt-status .vtt-empty-state-action', { timeout: 25000 })
    .then(() => true).catch(() => false);
} else {
  for (let i = 0; i < 50; i++) {
    await sleep(1500);
    const st = await page.evaluate(() => {
      const list = document.getElementById('vtt-list');
      return { len: (list?.innerText || '').trim().length, ob: !!document.getElementById('vtt-lang-onboarding'),
        status: !!document.getElementById('vtt-status') };
    });
    if (st.len > 80 && !st.ob && !st.status) { ok = true; break; }
  }
}
await sleep(1200);

const file = join(OUT, `live-${scene}-${lang}-1280x800.jpg`);
await page.screenshot({ path: file, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1280, height: 800 } });
console.log(`${ok ? '✓' : '! (unconfirmed)'} ${file.split('/').pop()}`);
browser.disconnect();
