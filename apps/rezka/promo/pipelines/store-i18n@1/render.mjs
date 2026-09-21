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
// This resolves to apps/rezka/_locales — HDrezka's own — which carries the same
// yt* key names as the YouTube edition (both read them from the shared UI).
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
    // Slide 5's word screen. Same rule as every string above: it comes from the
    // extension's own _locales, so a screenshot cannot show a label the product
    // does not use. A locale that has not translated these yet falls through to
    // English here exactly as the product itself does for that user.
    lookupRemove: g('ytLookupRemove', 'Remove'),
    lookupSrcDict: g('ytLookupSrcDict', 'dictionary'),
    lookupMore: g('ytLookupMore', 'Details'),
    lookupSave: g('ytLookupSave', 'Save'),
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

// THE PANEL'S THEME PER SLIDE: dark on slide 1, light on slide 3.
//
// This was briefly behind a SWAP_THEMES env flag writing to its own directory,
// which was wrong: it left the series rendering the OLD themes while the flag
// held the requested ones, so the two accepted changes — this and slide 1's
// violet glow — never appeared in one render. It is the series now. There is no
// flag and no second output directory.
//
// Both slides rebuild their panel in HTML rather than cropping a capture, so
// this is a stylesheet swap and needs no recapture. Each theme sheet is
// appended LAST, after the sheets that set the frame's original theme.
const OUT_DIR = OUT;
const SHOTS_DIR = SHOTS;
const BUILD_DIR = BUILD;

const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);
const SLIDES = [1, 2, 3, 4, 5];

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
// The HDrezka extension has no demo-subs.ts of its own: demo mode is a YouTube
// feature and the panel captures this pipeline crops are the YouTube build's.
// The transcript rows drawn in HTML must therefore come from the SAME file that
// produced those captures, or a rebuilt panel would show different lines than
// the cropped one beside it.
const DEMO_SUBS_TS = path.resolve(ASSETS, '../../../../../youtube/src/content/demo-subs.ts');
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
  return `${head(loc, ['fullscreen-panel.css', 'fullscreen-slide.css', 'fullscreen-warm.css',
                       'panel-theme-dark.css'])}
<body class="warm">
  <div class="frame">
    <img class="backdrop" src="${asset('fullscreen-backdrop.jpg')}" alt="" />
    <div class="scrim"></div>

    <div class="copy">
      <span class="eyebrow">${p('slide1', 'eyebrow')}</span>
      <h1>${p('slide1', 'title')}</h1>
      <p>${p('slide1', 'sub')}</p>
    </div>

    <!-- THE SAVED WORD, marked in the captions and carrying the card.
         The learning-side caption is the same Spanish line in all 54 locales
         (promo-copy.json: one unique slide1.caption), so marking a fixed word
         in it is safe — SLIDE1_HIT is anchored to the end of the line so a
         substring elsewhere cannot match. Only the card's BUTTON LABELS
         localize, from _locales like every other product string. -->
    <div class="captions">
      <span class="cap-main">${slide1Caption(p)}</span>
      <span class="cap-sub">${p('slide1', 'captionSub')}</span>
    </div>

    <!-- The lookup card, over the word it belongs to. Ported from
         store-en@6/slide1.html, where its geometry was solved: the card points
         at the caption's LAST word because the headline's paragraph fills the
         left half of the frame and a card over an earlier word lands on it.
         Position from scratchpad/align-card.mjs — measured, not nudged.

         THE WORD IS ALREADY SAVED, which is three linked facts rather than one
         decoration: the heart is filled and the button says what pressing it
         does NEXT (lookup/strip.ts:438); the caption word wears the HEART bar,
         not the accent one, even with a card open over it; and the same word is
         marked in the sidebar transcript. The last two are one subscription in
         the product — repaintSavedMarks paints over BOTH containers — so a
         slide marking only the caption would show a state the product cannot
         be in. -->
    <div class="lookup" style="left: 547.2px; bottom: 150.6px;">
      <div class="lk-body">
        <span class="lk-pos">adj.</span>
        <span class="${p('slide1', 'lookupIsDef') ? 'lk-def' : 'lk-tr'}">${p('slide1', 'lookupTr')}</span>
      </div>
      <div class="lk-acts">
        <span class="lk-btn saved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 22.5l7.1-7.1 1.7-1.7a5 5 0 0 0 0-7.1z"/></svg>
          <span>${ui.lookupRemove}</span>
        </span>
        <span class="lk-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>
          <span>${ui.lookupMore}</span>
        </span>
      </div>
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
              <div class="orig">Hoy vamos a aprender algo <span class="w saved">divertido</span></div>
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
              <div class="orig">Guarda las <span class="w saved">palabras</span> que no conozcas</div>
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
        <!-- v6: .selword and .quickpill are GONE. They staged a text selection
             and a "+ Lingogram" quick-add pill drawn in CSS over the capture,
             and the product removed that control in 1.0.21 — the slide went on
             rendering green and advertising a button that no longer exists.
             What the slide shows now is in the CAPTURE itself: the saved-word
             mark the product paints from the word mirror. -->
        <div class="spotlight"></div>
      </div>
      <div class="callout callout--saved" style="left:34px; bottom:-18px;">${p('slide2', 'callout')}</div>
    </div>
  </div>
</body></html>`;

// slide3 — guess mode, as a fullscreen frame with the dark panel.
const slide3 = (p, loc, s, ui) => {
  const tr = transFor(loc, 2, [0, 1]);
  return `${head(loc, ['fullscreen-panel-guess.css', 'fullscreen-slide-guess.css', 'fullscreen-dark.css', 'fullscreen-guess.css',
                       'panel-theme-light.css'])}
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

// Slide 5's caption is FIXED English, not the locale's language, and it carries
// the mark under the word the open screen is about. It is built here rather
// than read from promo-copy.json so a translator cannot accidentally localize
// it and break the pair the slide depends on — see the note on slide5 below.
// The copy file still carries slide5.caption for reference; this asserts they
// agree, so a future edit to one is not silently ignored.
// The word slide 1's card is open on, marked in the on-screen caption. The
// learning-side line is the same Spanish sentence in every locale, so this is a
// constant rather than per-locale copy; anchored to the end of the line so
// "divertido" inside a longer token could not match instead.
const SLIDE1_HIT = 'divertido';

function slide1Caption(p) {
  const line = p('slide1', 'caption');
  return line.replace(new RegExp(`${SLIDE1_HIT}$`), `<span class="hit saved">${SLIDE1_HIT}</span>`);
}

const SLIDE5_CAPTION = "Today we'll learn something fun";
// The word the HOVER CARD points at, and deliberately not the word the panel
// is showing. The card has to sit over its own word, and a card over "learn"
// (mid-line) lands on the headline's paragraph — measured: 212px of overlap
// across the paragraph's full height, at every scale down to 1.0, and hanging
// it below the caption instead runs it off the bottom of the frame. The last
// word is the one position that clears, which is the same solution slide 1
// reached for the same collision. See scratchpad/solve-hc2.mjs.
const SLIDE5_HIT = 'fun';
function slide5Caption(p) {
  const fromCopy = p('slide5', 'caption');
  if (fromCopy !== SLIDE5_CAPTION) {
    throw new Error(
      `slide5.caption in promo-copy.json is "${fromCopy}" but this slide renders `
      + `"${SLIDE5_CAPTION}". The caption is deliberately NOT localized (the slide `
      + `reverses the series' language pair); if it must change, change it in both.`);
  }
  // Anchored to the end of the line so "fun" inside "something" cannot match.
  return SLIDE5_CAPTION.replace(new RegExp(`${SLIDE5_HIT}$`), `<span class="hit">${SLIDE5_HIT}</span>`);
}

// slide5 — the built-in dictionary: the word screen, as a fullscreen frame with
// the dark panel. New in v6.
//
// WHAT IS AND IS NOT LOCALIZED HERE, because this slide is the exception in the
// series and the reason is worth stating once:
//
//   marketing copy  eyebrow/title/sub — promo-copy.json, per locale
//   product UI      "‹ Subtitles", the source badge, the Remove button —
//                   _locales/<loc>/messages.json, like every other panel string
//   the ARTICLE     literal, identical in every locale
//   the CAPTIONS    literal English over literal Spanish, every locale
//
// The last two are the exception. Everywhere else in the series the learner
// studies SPANISH and the translation rows follow the viewer's language. This
// slide reverses the pair — the learner studies ENGLISH with Spanish as their
// own language — because the two elements the screen exists to show only appear
// for an English learning language: the Oxford button is gated on it
// (shape.ts's oxfordLookupUrl — Oxford is a dictionary OF English) and the
// translations row only arrives for English headwords. A localized variant of
// this slide would have to drop both and show a poorer screen than the product
// gives, so the pair is fixed and the article with it.
const slide5 = (p, loc, s, ui) => `${head(loc, ['fullscreen-panel.css', 'fullscreen-slide.css', 'fullscreen-dark.css', 'fullscreen-wordscreen.css'])}
<body>
<div class="frame">
    
    <img class="backdrop" src="${asset('fullscreen-backdrop-word.jpg')}" alt="" />
    <div class="scrim"></div>

    <div class="copy">
      <span class="eyebrow">${p('slide5', 'eyebrow')}</span>
      <h1>${p('slide5', 'title')}</h1>
      <p>${p('slide5', 'sub')}</p>
    </div>

    
    <div class="captions">
      <span class="cap-main">${slide5Caption(p)}</span>
      <span class="cap-sub">${p('slide5', 'captionSub')}</span>
    </div>

    <!-- THE HOVER CARD, and the cursor that opened the panel.
         The paragraph promises two steps; this is the first one, so that the
         slide shows the cause (a pointer resting on "Details") next to its
         effect (the article filling the panel) instead of the effect alone.

         Everything in it is the real answer for THIS word, transcribed from
         the running extension rather than composed (scratchpad/probe-fun.mjs,
         en->es): "fun" is a noun, its three Spanish translations are
         diversión/gracia/trebejo, and it is NOT in the demo dictionary — so
         the heart is hollow and reads Save, where the panel's own footer two
         hundred pixels to the right reads Remove for "learn". The first draft
         of this card carried learn's article over fun's word, which every
         measurement passed and one look caught.

         The card and the panel therefore show two DIFFERENT words, which is
         the honest reading of the frame: the panel holds the article opened a
         moment ago, and the cursor is over the next word's card, about to open
         its own. Its geometry is the dark theme's, measured in the same run —
         see the hovercard block at the end of assets/fullscreen-wordscreen.css.

         POSITION: solved by scratchpad/place-hovercard.mjs, which renders the
         slide, finds the word "learn" in the caption, and reports the offsets
         that centre the card over it with the product's own 6px gap. Inline
         for the same reason slide 1's is: re-wording the caption is one edit
         plus one re-run, not a hunt through the stylesheet.

         The button labels are the product's own strings, so a locale that
         translates "Details" gets its own word here — the one element of this
         slide that localizes even though the article does not. -->
    <div class="hovercard" style="left: 540px; bottom: 150.6px;">
      <div class="hc-body">
        <span class="hc-pos">n.</span>
        <span class="hc-tr">diversión <span class="hc-sep">·</span> gracia <span class="hc-sep">·</span> trebejo</span>
      </div>
      <div class="hc-acts">
        <span class="hc-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 22.5l7.1-7.1 1.7-1.7a5 5 0 0 0 0-7.1z"/></svg>
          <span>${ui.lookupSave}</span>
        </span>
        <span class="hc-btn hover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>
          <span>${ui.lookupMore}</span>
        </span>
      </div>
      <svg class="hc-cursor" style="left: 159.2px; top: 68.8px;" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 3.2 L5.5 19.4 L9.6 15.6 L12.3 21.4 L15.1 20.1 L12.4 14.4 L18 14.2 Z"
              fill="#fff" stroke="#0a0a0c" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
    </div>

    <div class="tab">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </div>

    <div class="panel">
      <div class="p-header">
        <div class="p-top">
          
          <span class="backchip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            ${ui.title}
          </span>
          <span class="p-title">learn</span>
        </div>
        <div class="p-status">
          <span class="brand">LINGOGRAM</span>
          <span class="dot"></span>
          <span class="account">you@example.com</span>
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
          ${ui.onScreen}<span class="sw off"></span>
        </span>
      </div>

      <div class="article">
        <div class="a-head">
          <span class="a-word">learn</span>
          <span class="a-heart saved">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 22.5l7.1-7.1 1.7-1.7a5 5 0 0 0 0-7.1z"/></svg>
          </span>
          <span class="a-src">${ui.lookupSrcDict}</span>
        </div>

        
        <div class="a-trs">aprender · escarmentar · estudiar · enterarse</div>

        <div class="a-ctx">Today we'll <b>learn</b> something fun</div>

        <div class="a-group">
          <div class="a-grouphead">
            <span class="a-pos">v.</span>
            <span class="a-poslabel">Verb</span>
          </div>
          <div class="a-sense">
            <span class="a-num">1</span>
            <span>
              <span class="a-def">To acquire, or attempt to acquire knowledge or an ability to do something.</span>
              <div class="a-ex">It's time Dad learned (how) to change the oil in the car.</div>
            </span>
          </div>
          <div class="a-sense">
            <span class="a-num">2</span>
            <span>
              <span class="a-def">To attend a course or other educational activity.</span>
              <div class="a-ex">For, as he took delight to introduce me, I took delight to learn.</div>
            </span>
          </div>
          <div class="a-sense">
            <span class="a-num">3</span>
            <span>
              <span class="a-def">To gain knowledge from a bad experience so as to improve.</span>
              <div class="a-ex">learn from one's mistakes</div>
            </span>
          </div>
        </div>

        <div class="a-group">
          <div class="a-grouphead">
            <span class="a-pos">n.</span>
            <span class="a-poslabel">Noun</span>
          </div>
          <div class="a-sense">
            <span class="a-num">1</span>
            <span><span class="a-def">The act of learning something.</span></span>
          </div>
        </div>
      </div>

      
      <div class="a-foot">
        <span class="a-save saved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 22.5l7.1-7.1 1.7-1.7a5 5 0 0 0 0-7.1z"/></svg>
          ${ui.lookupRemove}
        </span>
        <span class="a-oxford">
          <span>Oxford</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>
        </span>
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



async function renderLocale(loc) {
  const build = path.join(BUILD_DIR, loc);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(SHOTS_DIR, loc), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, loc), { recursive: true });
  const p = copyFor(loc);
  const shots = shotsFor(loc);
  const ui = productStrings(loc);

  const ctx = await browser.newContext({ viewport: { ...CWS_SCREENSHOT }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const file = path.join(build, `slide${n}.html`);
    fs.writeFileSync(file, TEMPLATES[n](p, loc, shots, ui));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    // v6 has no overlay to place: slide 2's .selword/.quickpill went with the
    // product control they staged, so the per-locale measuring pass that moved
    // them onto the active card is gone too. What replaced them is in the
    // capture itself and needs no positioning.
    const shot = path.join(SHOTS_DIR, loc, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', String(CWS_SCREENSHOT.height), String(CWS_SCREENSHOT.width),
      shot, '--out', path.join(OUT_DIR, loc, `screenshot-${n}.png`)], { stdio: 'ignore' });
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
