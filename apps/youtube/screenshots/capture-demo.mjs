// Capture the promo "demo mode" sidebar over a real (colorful) YouTube video.
// Demo mode (#vtt-demo in the URL) fills the panel with canned dual subtitles
// and spotlights it — no caption fetch, so YouTube throttling is irrelevant.
//
//   node capture-demo.mjs --video kJQP7kiw5Fk --out live-sidebar-en-1280x800.jpg
//
// Uses Playwright's bundled Chrome for Testing (still honours --load-extension);
// never touches your real Chrome.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..', 'build');
// Optional AdBlock Plus (unpacked) to block YouTube ads → faster, cleaner shots.
const ABP = join(HERE, 'vendor', 'adblock-plus');
const HAS_ABP = existsSync(join(ABP, 'manifest.json'));
const EXTS = HAS_ABP ? `${BUILD},${ABP}` : BUILD;
const OUT = join(HERE, 'out-live');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };

const video = arg('video', 'kJQP7kiw5Fk');
// One or more demo modes captured from a SINGLE page load — the state is switched
// in-page via the URL hash (the content script re-renders on hashchange), so we
// never reload YouTube per screenshot. `--modes sidebar,onboarding,guess` for the
// full set, or a single `--mode`.
const modesArg = arg('modes', '');
const modes = modesArg
  ? modesArg.split(',').map((s) => s.trim()).filter(Boolean)
  : [arg('mode', 'sidebar')];               // sidebar | onboarding | guess

// Language pair for the demo. `--locale <code>` resolves the pair from
// promo/learn-corpus.json (native = the locale, learning = its top studied
// language); `--learn`/`--native` override explicitly. Defaults → es/en.
const LEARN_NAME_TO_CODE = {
  English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it',
  Portuguese: 'pt', Dutch: 'nl', Russian: 'ru', Swedish: 'sv', Arabic: 'ar',
  Chinese: 'zh_CN', Japanese: 'ja',
};
const locale = arg('locale', '');
let learn = arg('learn', '');
let native = arg('native', '');
if (locale) {
  native = native || locale;
  if (!learn) {
    const corpus = JSON.parse(readFileSync(join(HERE, '..', 'promo', 'learn-corpus.json'), 'utf8'));
    learn = LEARN_NAME_TO_CODE[corpus[locale]] || 'en';
  }
}
const params = [learn && `learn=${learn}`, native && `native=${native}`].filter(Boolean);
const paramStr = params.length ? `?${params.join('&')}` : '';
const baseHashFor = (m) =>
  m === 'onboarding' ? 'vtt-demo-onboarding' : m === 'guess' ? 'vtt-demo-guess' : 'vtt-demo';
const hashFor = (m) => baseHashFor(m) + paramStr;

// PNG (lossless, crisp UI text) at deviceScaleFactor 2 → 2560×1600 source, so
// the promo slides stay sharp when they scale/crop the capture.
const tag = locale || 'en';
const outFor = (m) => (m === 'sidebar' ? `live-demo-${tag}.png` : `live-demo-${m}-${tag}.png`);
const outOverride = arg('out', '');         // only honored for a single mode

const require = createRequire(import.meta.url);
const PW = '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = require(PW)); }

// Drive the extension UI language too, so the sidebar chrome (header, onboarding
// labels) localizes alongside the subtitle content. Chrome wants hyphens.
const chromeLocale = locale ? locale.replace('_', '-') : '';
const ctx = await chromium.launchPersistentContext(`/tmp/yt-shots-demo-${tag}`, {
  // New headless mode renders with NO visible window (so captures never steal
  // focus) yet still loads MV3 extensions and decodes video — unlike old
  // headless, which loads no extensions.
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  ...(chromeLocale ? { locale: chromeLocale } : {}),
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTS}`,
    `--load-extension=${EXTS}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    ...(chromeLocale ? [`--lang=${chromeLocale}`] : []),
  ],
});
if (HAS_ABP) await sleep(2500);   // let AdBlock Plus initialize its rulesets
// service worker just to confirm the extension loaded
let [sw] = ctx.serviceWorkers();
if (!sw) await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);

await ctx.addCookies([
  { name: 'SOCS', value: 'CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' },
  { name: 'CONSENT', value: 'YES+cb', domain: '.youtube.com', path: '/' },
]);

const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
const READY_SEL = '#vtt-list .vtt-item, #vtt-lang-onboarding';
await page.goto(`https://www.youtube.com/watch?v=${video}#${hashFor(modes[0])}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector(READY_SEL, { timeout: 30000 }).catch(() => {});

const safe = async (fn, a) => { try { return await page.evaluate(fn, a); } catch { return null; } };
const playClean = () => safe(() => {
  const v = document.querySelector('video');
  if (v) { v.muted = true; if (v.paused) { try { v.play(); } catch {} } }
  const player = document.querySelector('#movie_player, .html5-video-player');
  const ad = !!player && player.classList.contains('ad-showing');
  if (ad) document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')?.click();
  return { promo: document.body.classList.contains('vtt-promo'), playing: v ? !v.paused && v.currentTime > 0.5 : false, ad };
});

// Get the video playing on a clean (ad-free) frame ONCE — it keeps playing as we
// switch demo states, so subsequent shots stay ad-free too.
let ok = false, reloads = 0;
for (let i = 0; i < 60; i++) {
  await sleep(800);
  const st = await playClean();
  if (st && st.promo && st.playing && !st.ad) { ok = true; break; }
  if (st && st.ad && (i === 14 || i === 30) && reloads < 2) {
    reloads++;
    await page.goto(`https://www.youtube.com/watch?v=${video}#${hashFor(modes[0])}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForSelector(READY_SEL, { timeout: 30000 }).catch(() => {});
  }
}

// Capture each mode by switching state via the in-page hook (NOT the URL — a
// hash change resets YouTube's player to a black frame). The video keeps playing.
const L = learn || 'es', N = native || 'en';
for (let k = 0; k < modes.length; k++) {
  const m = modes[k];
  if (k > 0) await safe((s) => window.postMessage({ __lingogram: 'demo', state: s }, '*'), { mode: m, learn: L, native: N });
  await page.waitForFunction((mm) => (mm === 'onboarding'
    ? !!document.getElementById('vtt-lang-onboarding')
    : document.querySelectorAll('#vtt-list .vtt-item').length > 3), m, { timeout: 8000 }).catch(() => {});
  await playClean();
  await sleep(m === modes[0] ? 1500 : 900);
  const name = (modes.length === 1 && outOverride) ? outOverride : outFor(m);
  await page.screenshot({ path: join(OUT, name), type: 'png', clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log(`${ok ? '✓' : '! '}${name}`);
}
await ctx.close();
