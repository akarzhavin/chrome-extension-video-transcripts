// PIPELINE store-i18n@5 — the localized store screenshot series, every locale.
//
//   node pipelines/store-i18n@5/render.mjs                # all locales
//   node pipelines/store-i18n@5/render.mjs ru de fr       # only the given ones
//   node pipelines/store-i18n@5/render.mjs -j 4 ru de     # cap parallelism
//
// Renders the SAME four slides as store-en@5 but from JSON copy instead of
// static HTML, which is why they are separate pipelines rather than one with a
// flag: different source of truth, locale count, and output filename.
//
// v5 layouts (the series went 5 -> 4 when the fullscreen hero landed):
//   1  fullscreen hero      — product edge to edge over footage, panel right
//   2  personal dictionary  — sidebar crop, selection + quick-add pill staged
//   3  guess / active recall— fullscreen frame, dark panel, masked words
//   4  customisation        — settings panel crop  (capture: settings)
//
// TWO KINDS OF TEXT, TWO SOURCES OF TRUTH
// Marketing copy (eyebrow/title/sub/callout) comes from assets/promo-copy.json
// and is transcreated per locale. Product-UI strings inside the rebuilt panel
// (its title, the mode chips, "N words saved") come from the extension's OWN
// _locales/<loc>/messages.json — never from the copy file and never invented,
// so a screenshot can't show a mode name the product doesn't use.
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
const href = (p) => pathToFileURL(p).href;
const asset = (n) => href(path.join(ASSETS, n));
const shotUrl = (name) => href(path.join(SHOT_DIR, name));

// The extension's own translations, for the product UI drawn inside the slides.
const LOCALES_DIR = path.resolve(ASSETS, '../../../../_locales');
function productStrings(loc) {
  const read = (l) => {
    const f = path.join(LOCALES_DIR, l, 'messages.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  const m = read(loc) || read(loc.split('_')[0]) || read('en') || {};
  const en = read('en') || {};
  const g = (k, fb) => (m[k]?.message ?? en[k]?.message ?? fb);
  return {
    title: g('ytSidebarTitle', 'Subtitles'),
    dual: g('ytModeDual', 'Dual'),
    guessMode: g('ytModeGuess', 'Guess'),
    onScreen: g('ytModeOnScreen', 'On-screen'),
    saved: g('ytWordsSaved', '{count} words saved').replace('{count}', '142'),
    learnCode: 'ES',
    nativeCode: (loc.split('_')[0] || 'en').toUpperCase(),
  };
}

// Per-locale product captures, falling back to English when a locale has not
// been captured. kind: 'demo' | 'guess' | 'settings'.
function shotFor(loc, kind) {
  const name = kind === 'demo' ? `live-demo-${loc}.png` : `live-demo-${kind}-${loc}.png`;
  const en = kind === 'demo' ? 'live-demo-en.png' : `live-demo-${kind}-en.png`;
  return shotUrl(fs.existsSync(path.join(SHOT_DIR, name)) ? name : en);
}
const shotsFor = (loc) => ({
  demo: shotFor(loc, 'demo'),
  guess: shotFor(loc, 'guess'),
  settings: shotFor(loc, 'settings'),
});

const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);
const SLIDES = [1, 2, 3, 4];

function copyFor(loc) {
  const en = COPY.en;
  const l = COPY[loc] || {};
  return (slide, field) =>
    (l[slide] && l[slide][field] != null ? l[slide][field] : en[slide][field]);
}

// Slides 1 and 3 put the copy over footage; 2 and 4 put it on the pale ground.
// Both keep the COMPOSITION left-to-right so the capture-crop offsets hold, and
// apply RTL to the marketing copy only.
function head(loc, sheets) {
  const lang = loc.replace('_', '-');
  const rtl = RTL.has(loc)
    ? '<style>.copy{direction:rtl;text-align:right}.copy .hl{unicode-bidi:isolate}</style>'
    : '';
  const links = sheets.map((s) => `<link rel="stylesheet" href="${asset(s)}" />`).join('\n');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8" />\n${links}${rtl}</head>`;
}

const BRAND = `<div class="brand"><img src="${asset('brand-tile.png')}" alt="" /><span>Lingogram</span></div>`;

// The transcript rows the panels show.
//
// The ORIGINAL line of each row is the language being LEARNED — Spanish across
// the whole series, so those are fixed. The TRANSLATION row is the locale's own
// language, and it comes from the extension's own demo transcript
// (src/content/demo-subs.ts), not from promo-copy.json: index i of every
// language's array is the same sentence, so the pair is guaranteed to line up.
// That file already ships translations for every locale the store supports, so
// a Russian screenshot shows Russian translation rows rather than English ones.
const DEMO_SUBS_TS = path.resolve(ASSETS, '../../../../src/content/demo-subs.ts');
const DEMO_SUBS = (() => {
  // A tiny parse rather than an import: the renderer is plain ESM and the file
  // is TypeScript. The shape is a flat Record<string, string[]> of literals.
  const src = fs.readFileSync(DEMO_SUBS_TS, 'utf8');
  const body = src.slice(src.indexOf('DEMO_SUBS_BY_LANG'));
  const out = {};
  const re = /["']?([A-Za-z_]{2,6})["']?\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(body))) {
    const lines = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((x) => x[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    if (lines.length) out[m[1]] = lines;
  }
  return out;
})();

function demoLinesFor(loc) {
  return DEMO_SUBS[loc] || DEMO_SUBS[loc.split('_')[0]] || DEMO_SUBS.en;
}

// Slide 1 shows 8 rows; slide 3 (guess) reveals only the first two.
function transFor(loc, count, offsets) {
  const src = demoLinesFor(loc);
  const en = DEMO_SUBS.en || [];
  return (offsets ?? [...Array(count).keys()]).map((i) => src[i] ?? en[i] ?? '');
}

// slide1 — fullscreen hero: the product edge to edge over footage.
const slide1 = (p, loc, s, ui) => {
  const tr = transFor(loc, 8);
  return `${head(loc, ['fullscreen-panel.css', 'fullscreen-slide.css', 'fullscreen-warm.css'])}
<body>
  <div class="frame">
    <img class="backdrop" src="${asset('fullscreen-backdrop.jpg')}" alt="" />
    <div class="scrim"></div>

    <div class="copy">
      <span class="eyebrow">${p('slide1', 'eyebrow')}</span>
      <h1>${p('slide1', 'title')}</h1>
      <p>${p('slide1', 'sub')}</p>
    </div>

    <div class="captions">
      <span class="cap-main">${p('slide1', 'caption')}</span>
      <span class="cap-sub">${p('slide1', 'captionSub')}</span>
    </div>

    <div class="tab">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </div>

    <div class="panel">
          <div class="p-header">
            <div class="p-top">
              <span class="langpair">${ui.learnCode}<span class="arrow">⇄</span>${ui.nativeCode}</span>
              <span class="p-title">${ui.title}</span>
              <span class="p-gear">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </span>
            </div>
            <div class="p-status">
              <span class="brand">LINGOGRAM</span>
              <span class="dot"></span>
              <span class="saved">${ui.saved}</span>
            </div>
          </div>

          <div class="p-modes">
            <div class="seg">
              <button>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="1.5"/></svg>
              </button>
              <button class="active">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="18" height="6" rx="1.5"/></svg>
                ${ui.dual}
              </button>
              <button>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M4 8h5M12 8h3M18 8h2"/></svg>
              </button>
            </div>
            <span class="divider"></span>
            <span class="toggle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg>
              ${ui.onScreen}<span class="sw"></span>
            </span>
          </div>

          <div class="p-list">
            <div class="item">
              <div class="orig">Hola, ¿qué tal? Me alegro de verte</div>
              <div class="trans">${tr[0]}</div>
            </div>
            <div class="item active">
              <div class="orig">Hoy vamos a aprender algo divertido</div>
              <div class="trans">${tr[1]}</div>
            </div>
            <div class="item">
              <div class="orig">Escucha con calma y repite conmigo</div>
              <div class="trans">${tr[2]}</div>
            </div>
            <div class="item">
              <div class="orig">Mira cómo se pronuncia esta palabra</div>
              <div class="trans">${tr[3]}</div>
            </div>
            <div class="item">
              <div class="orig">No te preocupes si te equivocas</div>
              <div class="trans">${tr[4]}</div>
            </div>
            <div class="item">
              <div class="orig">Cada día entiendes un poco más</div>
              <div class="trans">${tr[5]}</div>
            </div>
            <div class="item">
              <div class="orig">Guarda las palabras que no conozcas</div>
              <div class="trans">${tr[6]}</div>
            </div>
            <div class="item">
              <div class="orig">¡Lo estás haciendo muy bien!</div>
              <div class="trans">${tr[7]}</div>
            </div>
          </div>
        </div>
  </div>
</body></html>`;
};


// WHERE THE SLIDE-2 OVERLAY GOES
//
// Slide 2 paints a selection swatch and a quick-add pill over the word "vamos"
// in the capture. Those were originally fixed coordinates measured from the
// English capture — which breaks the moment a locale's TRANSLATION row wraps to
// two lines, because that pushes the active card (and the Spanish line inside
// it) further down. Measured: en/ru/de put the card at y 371, id/sr/vi at 394,
// kn/ta at 401. A fixed offset leaves the swatch floating above the word.
//
// So the position is measured per locale instead of assumed: find the active
// card in the capture (it is the only lime one), then place the overlay on its
// first text line. The horizontal position is stable — the original line is the
// same Spanish sentence everywhere — so only the vertical needs solving.
async function overlayBoxFor(page, shotUrl) {
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      // The capture is 2560x1600; the panel occupies its right-hand 640px.
      const X = Math.round(img.width * 0.78);
      const d = g.getImageData(X, 0, 1, img.height).data;
      const lime = [];
      for (let y = 0; y < img.height; y++) {
        const r = d[y * 4], gg = d[y * 4 + 1], b = d[y * 4 + 2];
        if (r > 195 && gg > 225 && b < 200) lime.push(y);
      }
      if (!lime.length) return resolve(null);
      // Card top in CAPTURE pixels -> the shot is drawn at 1440x900 (1.125x of
      // 1280x800) inside a panel that is itself scaled, so convert through the
      // capture's own height.
      resolve({ cardTop: lime[0] / img.height, cardBottom: lime[lime.length - 1] / img.height });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }), shotUrl);
}

// slide2 — the personal dictionary: sidebar crop with the save moment staged.
const slide2 = (p, loc, s, ui) => `${head(loc, ['promo.css', 'save-slide.css'])}
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
        <div class="shot" style="background-image:url('${s.demo}'); left:-1080px; top:0;"></div>
        <div class="spotlight"></div>
        <div class="selword"></div>
        <div class="quickpill">+ Lingogram</div>
      </div>
      <div class="callout callout--saved" style="left:34px; bottom:-18px;">${p('slide2', 'callout')}</div>
    </div>
  </div>
</body></html>`;

// slide3 — guess mode, as a fullscreen frame with the dark panel.
const slide3 = (p, loc, s, ui) => {
  const tr = transFor(loc, 2, [0, 1]);
  return `${head(loc, ['fullscreen-panel-guess.css', 'fullscreen-slide-guess.css', 'fullscreen-dark.css', 'fullscreen-guess.css'])}
<body>
  <div class="frame">
    <img class="backdrop" src="${asset('fullscreen-backdrop-guess.jpg')}" alt="" />
    <div class="scrim"></div>

    <div class="copy">
      <span class="eyebrow">${p('slide3', 'eyebrow')}</span>
      <h1>${p('slide3', 'title')}</h1>
      <p>${p('slide3', 'sub')}</p>
    </div>

    <div class="captions">
      <span class="cap-main">Hoy <span class="mask">vamos</span> a <span class="mask">aprender</span> algo <span class="mask">divertido</span></span>
      <span class="cap-sub">${p('slide3', 'captionSub')}</span>
    </div>

    <div class="tab">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </div>

    <div class="panel">
          <div class="p-header">
            <div class="p-top">
              <span class="langpair">${ui.learnCode}<span class="arrow">⇄</span>${ui.nativeCode}</span>
              <span class="p-title">${ui.title}</span>
              <span class="p-gear">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </span>
            </div>
            <div class="p-status">
              <span class="brand">LINGOGRAM</span>
              <span class="dot"></span>
              <span class="saved">${ui.saved}</span>
            </div>
          </div>

          <!-- Guess is the selected mode here, not Dual. -->
          <div class="p-modes">
            <div class="seg">
              <button>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="1.5"/></svg>
              </button>
              <button>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="18" height="6" rx="1.5"/></svg>
              </button>
              <button class="active">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M4 8h5M12 8h3M18 8h2"/></svg>
                ${ui.guessMode}
              </button>
            </div>
            <span class="divider"></span>
            <span class="toggle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg>
              ${ui.onScreen}<span class="sw"></span>
            </span>
          </div>

          <!-- The line already played keeps its words; everything from the current
               line on is still masked. That ordering is the feature working, not a
               decorative mix. -->
          <div class="p-list">
            <div class="item">
              <div class="orig">Hola, ¿qué tal? Me alegro de verte</div>
              <div class="trans">${tr[0]}</div>
            </div>
            <div class="item active">
              <div class="orig">Hoy <span class="mask">vamos</span> a <span class="mask">aprender</span> <span class="mask">algo</span> <span class="mask">divertido</span></div>
              <div class="trans">${tr[1]}</div>
            </div>
            <div class="item">
              <div class="orig"><span class="mask">Escucha</span> con <span class="mask">calma</span> y <span class="mask">repite</span> <span class="mask">conmigo</span></div>
            </div>
            <div class="item">
              <div class="orig">Mira <span class="mask">cómo</span> se <span class="mask">pronuncia</span> <span class="mask">esta</span> <span class="mask">palabra</span></div>
            </div>
            <div class="item">
              <div class="orig">No te <span class="mask">preocupes</span> si te <span class="mask">equivocas</span></div>
            </div>
            <div class="item">
              <div class="orig"><span class="mask">Cada</span> día <span class="mask">entiendes</span> un <span class="mask">poco</span> <span class="mask">más</span></div>
            </div>
            <div class="item">
              <div class="orig"><span class="mask">Guarda</span> las <span class="mask">palabras</span> que no <span class="mask">conozcas</span></div>
            </div>
            <div class="item">
              <div class="orig">¡Lo <span class="mask">estás</span> <span class="mask">haciendo</span> muy <span class="mask">bien</span>!</div>
            </div>
          </div>
        </div>
  </div>
</body></html>`;
};

// slide4 — customisation: the settings panel crop.
const slide4 = (p, loc, s, ui) => `${head(loc, ['promo.css'])}
<body class="theme-3">
  <div class="slide slide--side">
    <div class="bg"></div>${BRAND}
    <div class="copy">
      <span class="eyebrow">${p('slide4', 'eyebrow')}</span>
      <h1>${p('slide4', 'title')}</h1>
      <p>${p('slide4', 'sub')}</p>
    </div>
    <div class="stage">
      <div class="panel">
        <div class="shot" style="background-image:url('${s.settings}'); left:-1080px; top:0;"></div>
      </div>
    </div>
  </div>
</body></html>`;

const TEMPLATES = { 1: slide1, 2: slide2, 3: slide3, 4: slide4 };

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

const unknown = argv.filter((a) => !KNOWN.includes(a));
if (unknown.length) {
  console.error(`unknown locale(s): ${unknown.join(', ')}`);
  console.error(`known: ${KNOWN.join(' ')}`);
  process.exit(1);
}

const locales = argv.length ? argv : KNOWN;

// Every locale falls back to the English capture, so those must exist even when
// a locale has its own. Verified before we spend time launching a browser.
requireCaptures(['live-demo-en.png', 'live-demo-guess-en.png', 'live-demo-settings-en.png']);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });


// Measures the rendered slide and moves .selword/.quickpill onto the active
// card's first text line. Runs in the page, after layout, so it sees exactly
// what the screenshot will capture.
async function placeOverlay(page) {
  await page.evaluate(() => {
    const panel = document.querySelector('.stage .panel');
    const sel = document.querySelector('.selword');
    const pill = document.querySelector('.quickpill');
    if (!panel || !sel) return;

    // Find the lime active card by sampling the composited panel: walk down a
    // column inside it and record where the lime ground starts.
    const r = panel.getBoundingClientRect();
    const c = document.createElement('canvas');
    const W = Math.round(r.width), H = Math.round(r.height);
    c.width = W; c.height = H;

    // The panel's content is a CSS background-image, which canvas cannot read
    // directly — so measure from the element's own backing image instead.
    const shot = panel.querySelector('.shot');
    const url = getComputedStyle(shot).backgroundImage.slice(5, -2);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const g = c.getContext('2d');
        // Reproduce the .shot placement: 1440x900 at (left, top) within the panel.
        const cs = getComputedStyle(shot);
        const left = parseFloat(cs.left), top = parseFloat(cs.top);
        g.drawImage(img, left, top, 1440, 900);
        const X = Math.round(W * 0.5);
        const d = g.getImageData(X, 0, 1, H).data;
        const lime = [];
        for (let y = 0; y < H; y++) {
          const rr = d[y * 4], gg = d[y * 4 + 1], bb = d[y * 4 + 2];
          if (rr > 195 && gg > 225 && bb < 200) lime.push(y);
        }
        if (lime.length) {
          // CAREFUL: the card position measured above is in RENDERED space, but
          // .selword/.quickpill take PRE-SCALE css values — .stage .panel carries
          // transform: scale(1.07), so anything written to style.top is
          // multiplied by 1.07 before it lands. Writing rendered pixels straight
          // back moves the overlay 7% too far, which is how the first attempt
          // shifted English off a position that had been correct.
          //
          // Calibrated against English, whose geometry was solved by hand and
          // verified pixel-identical to store-en@5: card top renders at 271,
          // swatch css top is 287.2, pill css top 255.7 (a fixed 31.5 above).
          const SCALE = 1.07;
          const EN_CARD_TOP = 271;         // rendered px
          const EN_SEL_CSS = 287.2;        // pre-scale px
          const PILL_GAP = 31.5;           // pre-scale px, sel -> pill
          const shift = (lime[0] - EN_CARD_TOP) / SCALE;
          const selTop = EN_SEL_CSS + shift;
          sel.style.top = selTop + 'px';
          if (pill) pill.style.top = (selTop - PILL_GAP) + 'px';
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  });
}

async function renderLocale(loc) {
  const build = path.join(BUILD, loc);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(SHOTS, loc), { recursive: true });
  fs.mkdirSync(path.join(OUT, loc), { recursive: true });
  const p = copyFor(loc);
  const shots = shotsFor(loc);
  const ui = productStrings(loc);

  const ctx = await browser.newContext({ viewport: { ...CWS_SCREENSHOT }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const file = path.join(build, `slide${n}.html`);
    fs.writeFileSync(file, TEMPLATES[n](p, loc, shots, ui));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    // Slide 2's overlay is anchored to the active card, which sits at a
    // different height per locale (a translation row that wraps pushes it down).
    // See overlayBoxFor's comment; without this the swatch floats above the word
    // in every locale whose translation is longer than English.
    if (n === 2 && !process.env.NO_OVERLAY_FIX) await placeOverlay(page);
    const shot = path.join(SHOTS, loc, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', String(CWS_SCREENSHOT.height), String(CWS_SCREENSHOT.width),
      shot, '--out', path.join(OUT, loc, `screenshot-${n}.png`)], { stdio: 'ignore' });
  }
  await ctx.close();
  if (!process.env.KEEP_BUILD) fs.rmSync(build, { recursive: true, force: true });
  console.log('\u2713 ' + loc);
}

console.log(`rendering ${locales.length} locale(s) with ${jobs} parallel pages\u2026`);
let next = 0;
async function worker() {
  while (next < locales.length) {
    const loc = locales[next++];
    try { await renderLocale(loc); }
    catch (e) { console.error(`\u2717 ${loc}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
await browser.close();
console.log(`done \u2192 ${MANIFEST.outputs.dir}/`);
