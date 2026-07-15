// Render the LOCALIZED promo screenshot series for every store locale.
//
//   node render-i18n.mjs                # all locales in promo-copy.json
//   node render-i18n.mjs ru de fr       # only the given locales
//   node render-i18n.mjs -j 4 ru de     # cap parallelism at 4 concurrent pages
//
// For each locale it writes self-contained slide1-5.html into build/<locale>/
// (absolute file:// asset paths so locales render in parallel without clobbering
// each other), screenshots them at deviceScaleFactor 2 (2560×1600), then
// downscales each to 1280×800 (Chrome Web Store size, alpha stripped by sips)
// into out/<locale>/screenshot-N.png — the folder layout the CWS autofill
// snippet expects (out/<lang>/… → language code from the subfolder name).
//
// Both the marketing copy (eyebrow / title / sub) and the embedded product
// shots are localized: each locale uses live-demo-<loc>.png etc. when present
// (captured via screenshots/capture-backdrop.mjs --locale <loc>), falling back
// to the English demo capture for any locale not yet captured.
//
// capture-backdrop.mjs covers the bot-walled YouTube player with our own CC-BY
// clip, so every locale now has a real playing frame + on-video dual subtitles.
// The hand-built live-demo-en-composite.png is therefore no longer needed here.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PW_FALLBACK =
  '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = require(PW_FALLBACK)); }

const COPY = JSON.parse(fs.readFileSync(path.join(HERE, 'promo-copy.json'), 'utf8'));
const SHOT_DIR = path.join(HERE, '..', 'screenshots', 'out-live');
const CSS_HREF = pathToFileURL(path.join(HERE, 'promo.css')).href;
const BRAND_TILE = pathToFileURL(path.join(HERE, 'brand-tile.png')).href;
const BRAND = `<div class="brand"><img src="${BRAND_TILE}" alt="" /><span>Lingogram</span></div>`;
const shotUrl = (name) => pathToFileURL(path.join(SHOT_DIR, name)).href;

// Per-locale product shots, falling back to the English demo capture when a
// locale hasn't been captured yet. kind: 'demo' | 'onboarding' | 'guess'.
function shotFor(loc, kind) {
  const name = kind === 'demo' ? `live-demo-${loc}.png` : `live-demo-${kind}-${loc}.png`;
  const en = kind === 'demo' ? 'live-demo-en.png' : `live-demo-${kind}-en.png`;
  return shotUrl(fs.existsSync(path.join(SHOT_DIR, name)) ? name : en);
}
function shotsFor(loc) {
  return { demo: shotFor(loc, 'demo'), onboarding: shotFor(loc, 'onboarding'), guess: shotFor(loc, 'guess') };
}

const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);
const SLIDES = [1, 2, 3, 4, 5];

// Localized copy with English fallback per field.
function copyFor(loc) {
  const en = COPY.en;
  const l = COPY[loc] || {};
  return (slide, field) =>
    (l[slide] && l[slide][field] != null ? l[slide][field] : en[slide][field]);
}

function head(loc) {
  const lang = loc.replace('_', '-');
  // Keep the slide COMPOSITION left-to-right (so the device-crop offsets hold)
  // and apply RTL only to the marketing copy text, so Arabic/Hebrew/Persian read
  // correctly without flipping the whole layout (which broke the slide-4 crop).
  const rtl = RTL.has(loc)
    ? '<style>.copy{direction:rtl;text-align:right}.copy .hl{unicode-bidi:isolate}</style>'
    : '';
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8" />
<link rel="stylesheet" href="${CSS_HREF}" />${rtl}</head>`;
}

// slide1 — stack layout, full browser window (dual subtitles hero)
const slide1 = (p, loc, s) => `${head(loc)}
<body class="theme-1">
  <div class="slide slide--stack">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide1', 'eyebrow')}</span>
      <h1>${p('slide1', 'title')}</h1>
      <p>${p('slide1', 'sub')}</p>
    </div>
    <div class="window">
      <div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">youtube.com/watch</span></div>
      <div class="window__view">
        <div class="shot" style="background-image:url('${s.demo}')"></div>
      </div>
    </div>
  </div>
</body></html>`;

// slide2 — side layout, sidebar panel crop
const slide2 = (p, loc, s) => `${head(loc)}
<body class="theme-2">
  <div class="slide slide--side">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide2', 'eyebrow')}</span>
      <h1>${p('slide2', 'title')}</h1>
      <p>${p('slide2', 'sub')}</p>
    </div>
    <div class="stage">
      <div class="panel">
        <div class="shot" style="background-image:url('${s.demo}'); left:-1058px; top:0;"></div>
      </div>
      <div class="callout" style="left:48px; bottom:-18px;">${p('slide2', 'callout')}</div>
    </div>
  </div>
</body></html>`;

// slide3 — side layout, guess-mode panel crop (active recall)
const slide3 = (p, loc, s) => `${head(loc)}
<body class="theme-3">
  <div class="slide slide--side">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide3', 'eyebrow')}</span>
      <h1>${p('slide3', 'title')}</h1>
      <p>${p('slide3', 'sub')}</p>
    </div>
    <div class="stage">
      <div class="panel">
        <div class="shot" style="background-image:url('${s.guess}'); left:-1058px; top:0;"></div>
      </div>
      <div class="callout" style="left:48px; bottom:-18px;"><kbd>Shift</kbd><span class="plus">+</span><kbd>G</kbd> ${p('slide3', 'callout')}</div>
    </div>
  </div>
</body></html>`;

// slide4 — side layout, on-video crop
const slide4 = (p, loc, s) => `${head(loc)}
<body class="theme-2">
  <div class="slide slide--side">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide4', 'eyebrow')}</span>
      <h1 style="font-size:45px;">${p('slide4', 'title')}</h1>
      <p>${p('slide4', 'sub')}</p>
    </div>
    <div class="stage">
      <div class="videoframe">
        <div class="shot" style="background-image:url('${s.demo}'); left:-15px; top:-74px;"></div>
      </div>
      <div class="callout" style="left:6px; bottom:-26px;">${p('slide4', 'callout')}</div>
    </div>
  </div>
</body></html>`;

// slide5 — side layout, onboarding panel crop (setup / zero-friction close)
const slide5 = (p, loc, s) => `${head(loc)}
<body class="theme-3">
  <div class="slide slide--side">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide5', 'eyebrow')}</span>
      <h1>${p('slide5', 'title')}</h1>
      <p>${p('slide5', 'sub')}</p>
    </div>
    <div class="stage">
      <div class="panel" style="height:500px;">
        <div class="shot" style="background-image:url('${s.onboarding}'); left:-1058px; top:0;"></div>
      </div>
    </div>
  </div>
</body></html>`;

const TEMPLATES = { 1: slide1, 2: slide2, 3: slide3, 4: slide4, 5: slide5 };

let argv = process.argv.slice(2);
let jobs = Math.min(os.cpus().length, 8);
if (argv[0] === '-j') { jobs = parseInt(argv[1], 10); argv = argv.slice(2); }
const locales = argv.length
  ? argv
  : Object.keys(COPY).filter((k) => !k.startsWith('_'));

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

async function renderLocale(loc) {
  const build = path.join(HERE, 'build', loc);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(HERE, 'shots', loc), { recursive: true });
  fs.mkdirSync(path.join(HERE, 'out', loc), { recursive: true });
  const p = copyFor(loc);
  const shots = shotsFor(loc);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const file = path.join(build, `slide${n}.html`);
    fs.writeFileSync(file, TEMPLATES[n](p, loc, shots));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    const shot = path.join(HERE, 'shots', loc, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', '800', '1280', shot, '--out',
      path.join(HERE, 'out', loc, `screenshot-${n}.png`)], { stdio: 'ignore' });
  }
  await ctx.close();
  fs.rmSync(build, { recursive: true, force: true });
  console.log('✓ ' + loc);
}

console.log(`rendering ${locales.length} locale(s) with ${jobs} parallel pages…`);
let next = 0;
async function worker() {
  while (next < locales.length) {
    const loc = locales[next++];
    try { await renderLocale(loc); }
    catch (e) { console.error('✗ ' + loc + ': ' + e.message); }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, locales.length) }, worker));
await browser.close();
try { fs.rmdirSync(path.join(HERE, 'build')); } catch {}
console.log('done → out/<locale>/screenshot-N.png');
