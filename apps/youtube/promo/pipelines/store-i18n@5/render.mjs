// PIPELINE store-i18n@5 — the localized store screenshot series, every locale.
//
//   node pipelines/store-i18n@5/render.mjs                # all 54 locales
//   node pipelines/store-i18n@5/render.mjs ru de fr       # only the given ones
//   node pipelines/store-i18n@5/render.mjs -j 4 ru de     # cap parallelism
//
// Everything this pipeline needs is beside it: manifest.json describes it,
// assets/ holds its CSS, brand mark and the localized copy, lib.mjs is its
// runtime. The product captures (~345 MB, shared by every pipeline) stay in
// screenshots/out-live/ and are declared in the manifest — see lib.mjs.
//
// Renders the SAME layouts as store-en@5 but from JSON copy instead of static
// HTML, which is why they are separate pipelines rather than one with a flag:
// different source of truth, locale count, and output filename.
//
// Per locale it writes self-contained slide1-5.html into a scratch build dir
// (absolute file:// asset paths, so locales render in parallel without
// clobbering each other), screenshots them at deviceScaleFactor 2, then
// downscales each to 1280x800 (alpha stripped by sips).
//
// Both the copy and the embedded product shots are localized: each locale uses
// live-demo-<loc>.png when present, falling back to the English capture.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  chromium, CWS_SCREENSHOT, ASSETS, BUILD, CAPTURES, ID, MANIFEST, OUT, SHOTS,
  requireCaptures,
} from './lib.mjs';

const COPY = JSON.parse(fs.readFileSync(path.join(ASSETS, 'promo-copy.json'), 'utf8'));
const SHOT_DIR = CAPTURES;
const CSS_HREF = pathToFileURL(path.join(ASSETS, 'promo.css')).href;
const BRAND_TILE_HREF = pathToFileURL(path.join(ASSETS, 'brand-tile.png')).href;
const BRAND = `<div class="brand"><img src="${BRAND_TILE_HREF}" alt="" /><span>Lingogram</span></div>`;
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

const KNOWN = Object.keys(COPY).filter((k) => !k.startsWith('_'));

if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`usage: ${MANIFEST.run}

  no locales   render all ${KNOWN.length} locales in assets/promo-copy.json
  -j N         cap parallelism at N concurrent pages (default: min(cpus, 8))

writes ${MANIFEST.outputs.dir}/<locale>/screenshot-<n>.png`);
  process.exit(0);
}

// Anything unknown used to be rendered as if it were a locale — a stray
// `--help` once produced a whole shots/--help/ slide set. Fail instead.
const unknown = argv.filter((a) => !KNOWN.includes(a));
if (unknown.length) {
  console.error(`unknown locale(s): ${unknown.join(', ')}`);
  console.error(`known: ${KNOWN.join(' ')}`);
  process.exit(1);
}

const locales = argv.length ? argv : KNOWN;

// Every locale falls back to the English capture, so those must exist even when
// a locale has its own. Verified before we spend time launching a browser.
requireCaptures(['live-demo-en.png', 'live-demo-guess-en.png', 'live-demo-onboarding-en.png']);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

async function renderLocale(loc) {
  const build = path.join(BUILD, loc);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(SHOTS, loc), { recursive: true });
  fs.mkdirSync(path.join(OUT, loc), { recursive: true });
  const p = copyFor(loc);
  const shots = shotsFor(loc);

  const ctx = await browser.newContext({ viewport: { ...CWS_SCREENSHOT }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const file = path.join(build, `slide${n}.html`);
    fs.writeFileSync(file, TEMPLATES[n](p, loc, shots));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    const shot = path.join(SHOTS, loc, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', String(CWS_SCREENSHOT.height), String(CWS_SCREENSHOT.width),
      shot, '--out', path.join(OUT, loc, `screenshot-${n}.png`)], { stdio: 'ignore' });
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
try { fs.rmdirSync(BUILD); } catch {}
console.log(`done → ${MANIFEST.outputs.dir}/<locale>/screenshot-N.png`);
