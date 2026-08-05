// Static-site generator for lingogram.ai.
//
//   node build.mjs            # render build/ from src/
//   node build.mjs --watch    # rebuild on any change under src/
//
// Everything is data-driven: src/data/editions.json defines the extension
// family — adding a record there creates the card on the home page and the
// /<slug>/ landing page. No dependencies; plain template literals.
//
// The privacy page is rendered from apps/youtube/PRIVACY_POLICY.md at build
// time (single source of truth until a family-wide policy is written).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const OUT = path.join(HERE, 'build');

const SITE = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'site.json'), 'utf8'));
const EDITIONS = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'editions.json'), 'utf8'));

// Cache-buster: python http.server sends no Cache-Control, so browsers may
// keep serving stale css/js after a rebuild. New value every build.
const BUST = Date.now().toString(36);

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const href = (url) => url || '#';

// Joins pre-rendered HTML fragments with a single space, skipping empty ones
// so a locale can leave a fragment blank (e.g. Hebrew's auth headline, which
// has no natural word to put in the lead slot) without leaving a stray space
// or an orphaned prefix letter in the output.
const joinFrags = (...frags) => frags.filter((f) => f !== '').join(' ');

// Emits one data-count-<category> attribute per CLDR plural category a
// locale's `languages.count` object declares (one/few/many/other, etc. —
// see Intl.PluralRules; a language only defines the categories it actually
// grammaticalizes). `other` is mandatory: main.js falls back to it client-side
// when Intl.PluralRules.select() returns a category this locale didn't need
// to declare (e.g. English has no "few", so English only ships "other").
const countAttrs = (count) => Object.entries(count)
  .map(([cat, str]) => ` data-count-${cat}="${esc(str)}"`).join('');

// Store links carry the page's language as `?hl=<lang>`, so a visitor reading
// /ru/ lands on the RUSSIAN listing. Without it the store picks by BROWSER
// language, not by the page they came from — a Russian speaker on an English
// browser would get the English listing.
//
// No code mapping is needed: all 42 site locales were probed against the live
// listing and every one returns a genuinely translated page, zero fallbacks.
// The store normalizes the shapes that differ from our codes on its own —
// zh->zh-CN, pt->pt-BR, he->iw — so pass the code through verbatim and do NOT
// reintroduce an exception table here; it would only drift from the store.
//
// This localizes the LISTING page. The extension's own UI language comes from
// _locales and is chosen by Chrome at install time; no URL can change that.
const storeHref = (url, lang) => {
  if (!url) return '#';
  return `${url}?hl=${encodeURIComponent(lang)}`;
};

// ---------------------------------------------------------------- i18n
//
// UI copy lives in src/data/i18n/<lang>.json (checked-in, not editions.json —
// editions.json is the extension family's data, not page strings). `en` is
// the source of truth: every OTHER locale is validated against its key set
// at build time, so a translator adding a key to ru.json without adding it
// to en.json (or a build after an en.json rename) fails loudly instead of
// serving `undefined` on a live page. Each locale renders its own full page
// tree — this is NOT a runtime i18n switch, it is 42 independent builds.
const I18N_DIR = path.join(SRC, 'data', 'i18n');
const EN_STRINGS = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8'));
const LOCALE_FILES = fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'));

// Plural-form objects are compared as a single key, not key-by-key: the whole
// point of `languages.count` is that each locale declares only the CLDR
// categories it grammaticalizes (en has one/other, ru adds few/many, ar adds
// zero/two). Recursing into them would flag every non-English category as
// "extra" and force all 42 locales down to English's two forms. The categories
// themselves are validated by Intl.PluralRules at runtime, with `other` as the
// guaranteed fallback — so the check below still asserts `languages.count`
// exists everywhere, just not which forms live inside it.
const PLURAL_KEYS = new Set(['languages.count']);
const flattenKeys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !PLURAL_KEYS.has(`${prefix}${k}`)
      ? flattenKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]);
const EN_KEYS = new Set(flattenKeys(EN_STRINGS));

const LOCALES = LOCALE_FILES.map((f) => {
  const code = f.replace(/\.json$/, '');
  const strings = code === 'en' ? EN_STRINGS : JSON.parse(fs.readFileSync(path.join(I18N_DIR, f), 'utf8'));
  if (code !== 'en') {
    const keys = new Set(flattenKeys(strings));
    const missing = [...EN_KEYS].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !EN_KEYS.has(k));
    if (missing.length || extra.length) {
      throw new Error(
        `i18n/${f} is out of sync with en.json` +
        (missing.length ? `\n  missing: ${missing.join(', ')}` : '') +
        (extra.length ? `\n  extra: ${extra.join(', ')}` : ''),
      );
    }
  }
  return { code, strings };
});

// `t('home.h1Lead')` → nested lookup; `{name}` placeholders filled from the
// second arg. Missing keys throw at build time (see LOCALES validation
// above) rather than rendering "undefined" on a live page — the one runtime
// exception is a translator's raw JSON edit bypassing that check, so this
// stays a hard error too, not a silent fallback to English.
const makeT = (strings) => (key, vars) => {
  let v = key.split('.').reduce((o, k) => o?.[k], strings);
  if (v === undefined) throw new Error(`i18n: missing key "${key}"`);
  if (vars) for (const [k, val] of Object.entries(vars)) v = v.replaceAll(`{${k}}`, val);
  return v;
};

// ---------------------------------------------------------------- fragments

// The brand mark is the shipped extension icon (apps/rezka/src/assets/icons/
// icon1254.png, downscaled into src/assets/logo.png). It already carries its
// own rounded-square backdrop, so .logo-mark is just a sizing box around it.
const CHAMELEON = (size) =>
  `<img class="logo-img" src="/logo.png" width="${size}" height="${size}" alt="" aria-hidden="true">`;

const CHROME_ICON = `
<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/>
  <path d="M12 8.4h8.5M8.9 13.9 4.7 6.6M15 13.9l-4.2 7.4"/>
</svg>`;

// Site logos, drawn as SVG so they are the real marks rather than lookalikes
// built from CSS borders and a serif capital. Nominative use — we name the
// sites Lingogram runs on — so each keeps its own brand colour and official
// geometry, and none is altered or recoloured.
//   yt: the YouTube play badge — rounded rect + white triangle.
//   nf: the Netflix "N" — NOT a typeset letter, but three strokes: the left
//       and right uprights plus the diagonal that crosses between them.
//   hd: HDrezka ships no published mark, so it stays a wordmark — a lettered
//       tile is honest here, unlike inventing a logo the site doesn't have.
const SITE_LOGO = {
  yt: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect width="24" height="24" rx="5.4" fill="#FF0000"/><path d="M9.9 7.9 16.6 12l-6.7 4.1V7.9Z" fill="#fff"/></svg>`,
  nf: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect width="24" height="24" rx="5.4" fill="#000"/><path d="M8 4.4h3.55v15.2H8z" fill="#B1060F"/><path d="M12.45 4.4H16v15.2h-3.55z" fill="#B1060F"/><path d="M8 4.4h3.42L16 19.6h-3.42L8 4.4Z" fill="#E50914"/></svg>`,
  hd: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect width="24" height="24" rx="5.4" fill="#1F1B16"/><text x="12" y="15.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8.6" font-weight="700" fill="#F2A33C" letter-spacing=".2">HD</text></svg>`,
};

const mark = (kind, small = false) =>
  `<span class="mark ${small ? 'mark-sm ' : ''}mark-${kind}" aria-hidden="true">${SITE_LOGO[kind]}</span>`;

// `root` is the locale's URL prefix: '' for English (unprefixed, at /), or
// '/ru' etc. for every other locale — every internal href is built from it
// so a translated page never links back out to the English tree.
const navLinks = (t, root) => `
  <a href="${root}/#platforms">${esc(t('nav.editions'))}</a>
  <a href="${root}/#how">${esc(t('nav.how'))}</a>
  <a href="${root}/#dictionary">${esc(t('nav.dictionary'))}</a>
  <a href="${root}/#faq">${esc(t('nav.faq'))}</a>`;

// `here` names the auth page we are ON ('login' | 'register'), so its own
// button can be dropped: offering "Log in" on /login/ is a link back to the
// page you are already reading, and following it wipes anything typed into
// the form. Dropping one also frees header room on narrow screens.
const header = (t, root, here) => `
<header class="site wrap">
  <a class="logo" href="${root}/">
    <span class="logo-mark">${CHAMELEON(24)}</span>
    <span class="logo-name">Lingogram</span>
  </a>
  <nav class="top">${navLinks(t, root)}</nav>
  <!-- Switches the LOCALE: a full navigation to the equivalent /<lang>/ page,
       which also repaints the demo's language pair — the live demo's second
       track, the phone films, the miniatures' sample line all key off the
       same page locale.

       TWO controls, one shown at a time by CSS (see the 760px block in
       site.css). Desktop gets a searchable popover, filled by demo.js
       (wireLangSwitch in src/demo/index.ts) and hidden until it is — a
       42-item list wants a filter, and a mouse makes typing natural. Narrow
       viewports get a plain LINK to /languages/ instead: the popover's names
       ran off the edge of a phone header, and a page has the room the panel
       never had. The link is server-rendered, so it also covers the auth
       pages, which never load demo.js. -->
  <span class="lang-wrap" hidden>
    <button type="button" class="lang-face" id="lang-switch-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="lf-name"></span>
      <svg class="lf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="lang-panel" id="lang-panel">
      <div class="lang-search-row">
        <input type="text" class="lang-search" id="lang-search" placeholder="${esc(t('nav.searchLanguage'))}" autocomplete="off" aria-label="${esc(t('nav.searchLanguage'))}">
      </div>
      <div class="lang-list" id="lang-list" role="listbox" data-suggested="${esc(t('nav.suggested'))}" data-all="${esc(t('nav.allLanguages'))}" data-empty="${esc(t('nav.noLanguageMatch'))}"></div>
    </div>
  </span>
  <a class="lang-link" href="${root}/languages/" aria-label="${esc(t('nav.language'))}">
    <svg class="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/></svg>
    <span>${esc(t('meta.htmlLang')).toUpperCase()}</span>
  </a>
  ${here === 'login' ? '' : `<a class="btn btn-ghost btn-login" href="${root}/login/">${esc(t('nav.logIn'))}</a>`}
  ${here === 'register' ? '' : `<a class="btn btn-primary btn-login" href="${root}/register/">${esc(t('nav.signUp'))}</a>`}
  <details class="mnav">
    <summary aria-label="${esc(t('nav.menu'))}">☰</summary>
    <div class="mnav-panel">${navLinks(t, root)}</div>
  </details>
</header>`;

const footer = (t, root) => `
<footer class="site wrap">
  <div class="f-col">
    <b>Lingogram</b>
    <span>© ${new Date().getFullYear()} Lingogram<br>${esc(t('footer.tagline'))}</span>
  </div>
  <div class="f-col">
    <b>${esc(t('footer.product'))}</b>
    <a href="${root}/#platforms">${esc(t('footer.allEditions'))}</a>
    <a href="${SITE.appUrl}">${esc(t('footer.yourDictionary'))}</a>
    <a href="${root}/#how">${esc(t('footer.howItWorks'))}</a>
  </div>
  <div class="f-col">
    <b>${esc(t('footer.help'))}</b>
    <a href="${root}/#faq">${esc(t('footer.faq'))}</a>
    <a href="mailto:${SITE.supportEmail}">${esc(t('footer.support'))}</a>
    <a href="mailto:${SITE.supportEmail}?subject=${encodeURIComponent(t('footer.suggestSubject'))}">${esc(t('footer.suggestSite'))}</a>
  </div>
  <div class="f-col">
    <b>${esc(t('footer.legal'))}</b>
    <a href="${root}/privacy/">${esc(t('footer.privacyPolicy'))}</a>
  </div>
</footer>`;

// Proof strip renders only when the numbers are real (principle: page truth =
// product truth — no placeholder ratings on a public page).
const proof = (t) => {
  const p = SITE.proof || {};
  if (!p.rating || !p.users) return '';
  return `
  <p class="proof">
    <span><span class="stars">★★★★★</span> <b>${esc(p.rating)}</b> ${esc(t('proof.rating'))}</span>
    <span class="sep">•</span><span><b>${esc(p.users)}</b> ${esc(t('proof.learners'))}</span>
    <span class="sep">•</span><span>${esc(t('proof.free'))}</span>
  </p>`;
};

// The three sites Lingogram runs on, as browser tabs across the top of the
// demo card. They replaced a single fake address bar: the URL named only
// YouTube, while the tabs name all three sites in the one place a visitor is
// already looking. Purely decorative — nothing here is clickable, so the
// active tab is marked by SHAPE (raised, fused with the panel below) rather
// than an accent bar, which would promise a switch that isn't there.
// `active` is the edition slug whose tab is lit: the home page shows the
// YouTube demo, and each edition page lights its own site.
const DEMO_TABS = [
  { slug: 'youtube', site: 'YouTube', mark: 'yt' },
  { slug: 'netflix', site: 'Netflix', mark: 'nf' },
  { slug: 'rezka', site: 'HDrezka', mark: 'hd' },
];

const demoTabs = (active) => DEMO_TABS.map((tb) => {
  const on = tb.slug === active;
  return `<span class="dtab${on ? ' is-on' : ''}">` +
    `<span class="dfav">${SITE_LOGO[tb.mark]}</span>` +
    `<span class="dtab-name">${esc(tb.site)}</span></span>`;
}).join('');

const demo = (t, active) => `
<div class="demo" id="demo">
  <!-- aria-hidden: decorative browser chrome, not a control. -->
  <div class="demo-chrome" aria-hidden="true">
    <span class="dots">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
    </span>
    <span class="dtabs">${demoTabs(active)}</span>
  </div>
  <!-- @video-transcripts/embed mounts the extension UI here. -->
  <div id="demo-embed"></div>
</div>
<p class="demo-hint">${esc(t('demo.hintPrefix'))} <b>${esc(t('demo.hintBold'))}</b> ${esc(t('demo.hintSuffix'))}<br><span class="demo-credit">${esc(t('demo.credit'))} <a href="https://www.nasa.gov/cosmic-dawn/" rel="noopener">${esc(t('demo.creditLink'))}</a> ${esc(t('demo.creditSuffix'))}</span></p>
${modes(t)}`;

// One compact slider explaining the modes, sitting right under the demo. Each
// slide opens with an ANIMATED miniature of the player in that state — the
// guess slide plays the actual gesture: masked line, a tap, the reveal — in
// the same visual language as the real overlay (white line, yellow
// translation, dark pill). The line is a real one from the demo clip;
// src/demo/index.ts swaps the translation to the visitor's own language.
// The slider is two-way: a slide's CTA switches the demo above (data-mode),
// and switching modes IN the demo's own panel brings up the matching slide
// (embed onModeChange → wireModeSlider). Auto-advances gently until the
// visitor touches either.
const VIZ_LINE = 'Science is a process.';
const VIZ_LINE_MASKED = 'Science *** * ***'; // how guess mode masks it: first word stays
// The guess miniature reveals the line word by word. `mask` is what stands in
// before that word's tap — the real mode masks each letter, so the dot count
// tracks the word's length. The first word is never masked (the product gives
// it away as the anchor), so it carries no reveal animation, and the tap that
// opens the LAST word also pays out the translation — three taps, not four.
const GUESS_WORDS = [
  { text: 'Science', mask: 'Science' },
  { text: 'is', mask: '**' },
  { text: 'a', mask: '*' },
  { text: 'process.', mask: '*******.' },
];
const VIZ_NATIVE_FALLBACK = 'Наука — это процесс.'; // replaced per-visitor by JS

// The panel strip (transcript ghost) keeps every miniature reading as "that
// player above"; the progress bar keeps it reading as video.
const PANEL_GHOST = '<span class="viz-panel" aria-hidden="true"><i></i><i></i><i></i></span>';

// The sidebar's On-screen glyph, copied from SidebarUI ICONS.onScreen (a video
// frame with a caption bar inside). Only the button being TAUGHT gets its real
// icon — everything else in the miniature stays abstract, so the one concrete
// glyph is unmistakably the thing to look at.
const OS_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 14.5h12"/></svg>`;

// The collapse tab's chevron, copied from SidebarUI's #vtt-toggle-btn. The tab
// rides the sidebar's left edge and is what actually opens and closes the
// panel, so the On-screen miniature taps THIS, not an invented control.
const TAB_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

// The miniatures show one sample caption line, always in English + a Russian
// placeholder (src/demo/index.ts swaps the translation to the visitor's own
// language at runtime, same as the live demo) — the sample is illustrative,
// not page copy, so it does not localize per site language.
const viz = {
  dual: `
      ${PANEL_GHOST}
      <span class="viz-caption">
        <span class="viz-line viz-main">${esc(VIZ_LINE)}</span>
        <span class="viz-line viz-tr anim-dual-tr" data-viz-native>${esc(VIZ_NATIVE_FALLBACK)}</span>
      </span>`,
  // The guess gesture, looped, in the order the product actually plays it:
  // the visitor taps the SAME line in the sidebar three times, each tap
  // uncovering one more word ON THE OVERLAY — and the last tap, which
  // completes the line, brings the translation up with it. The taps land on
  // the panel row (abstract, no text: it's the gesture that matters, not what
  // the row says), the payoff lands on the video, where the eye already is.
  guess: `
      <span class="viz-panel" aria-hidden="true">
        <i></i><i class="viz-row-tap"></i><i></i>
        <span class="viz-tapdot" aria-hidden="true"></span>
      </span>
      <span class="viz-caption">
        <span class="viz-line viz-main viz-masked">${GUESS_WORDS.map(
          (w, i) => (i === 0
            ? `<b class="viz-w is-open"><em>${esc(w.text)}</em></b>`
            : `<b class="viz-w anim-gw${i}"><s>${esc(w.mask)}</s><em>${esc(w.text)}</em></b>`)
        ).join(' ')}</span>
        <span class="viz-line viz-tr anim-gtr" data-viz-native>${esc(VIZ_NATIVE_FALLBACK)}</span>
      </span>`,
  // The slide is about WHERE the subtitles live, and the product has two
  // controls for that, so the loop plays BOTH in the order a real viewer meets
  // them:
  //   1. tap the On-screen chip (ICONS.onScreen) — captions leave the film, the
  //      chip dims, and reading moves to the panel's rows, which light up;
  //   2. tap the collapse tab (#vtt-toggle-btn's chevron, riding the panel's
  //      left edge) — the panel slides off and the film gets the whole frame;
  //   3. tap the tab again — the panel returns, and the chip relights, putting
  //      the captions back where the loop started.
  // Each tap lands on the control and its payoff lands where the eye already
  // is — the same split the guess slide uses. Both glyphs are the real ones, so
  // the visitor meets the exact two buttons they'll find in the panel.
  single: `
      <span class="viz-panel anim-ospanel" aria-hidden="true">
        <span class="viz-tab anim-ostab">${TAB_CHEVRON}<span class="viz-tapdot viz-tapdot-chip anim-ostap" aria-hidden="true"></span></span>
        <span class="viz-chiprow">
          <i class="viz-chip"></i>
          <u class="viz-chipdiv"></u>
          <i class="viz-chip anim-oschip">${OS_GLYPH}<span class="viz-tapdot viz-tapdot-chip anim-ostap-chip" aria-hidden="true"></span></i>
        </span>
        <i class="anim-osrow"></i><i class="anim-osrow"></i>
      </span>
      <!-- The captions re-centre on the whole frame once the panel is gone —
           the film literally gets the room back, which is the payoff. -->
      <span class="viz-caption anim-oscap">
        <span class="viz-line viz-main">${esc(VIZ_LINE)}</span>
        <span class="viz-line viz-tr" data-viz-native>${esc(VIZ_NATIVE_FALLBACK)}</span>
      </span>
      <!-- Names the two states. Without them a vanishing panel reads as a thing
           being switched OFF; with them it reads as a CHOICE of where to read —
           the sidebar, or the film. Each label lights only in its own state. -->
      <span class="viz-where viz-where-screen anim-oswhere-a">On screen</span>
      <span class="viz-where viz-where-panel anim-oswhere-b">In sidebar</span>`,
  // The dictionary flow, looped, matching the real quick-add overlay beat for
  // beat: the word is DRAG-selected (a highlight band sweeping left→right under
  // an I-beam cursor, the way a mouse actually pulls one) → the "+ Lingogram"
  // pill pops ABOVE it → the click saves, leaving the word underlined with a
  // "✓ saved" badge → the green toast confirms in the corner. Wording and
  // colours are the ones shipped in quick-add-overlay.ts; a miniature that
  // invents its own would teach the visitor a UI that doesn't exist.
  save: `
      ${PANEL_GHOST}
      <span class="viz-caption">
        <span class="viz-line viz-main">Science is a <span class="viz-selwrap"><mark
          class="viz-sel anim-sel anim-saved">process</mark><span
          class="viz-caret anim-caret" aria-hidden="true"></span><span class="viz-pill anim-pill"
          >+ Lingogram</span></span>.<span class="viz-savedbadge anim-badge">✓ saved</span></span>
      </span>
      <span class="viz-toast anim-toast">Added: process</span>`,
};

// "Dual subtitles" over plain "Dual" in the tab: it is crawlable page copy,
// and dual subtitles is the keyword the family is positioned on. The tab,
// not a mode switch, drives the On-screen slide: forcing displayMode
// 'single' unlit both mode chips in the demo's panel — reading as "everything
// deactivated" while the miniature shows the mode chip staying lit.
// demo/index.ts keeps the mode and pulses the on-video captions instead
// (showOnScreen).
const SLIDE_IDS = ['dual', 'guess', 'single', 'save'];
const slides = (t) => SLIDE_IDS.map((id) => ({
  id,
  tab: t(`modes.${id}.tab`),
  title: t(`modes.${id}.h`),
  body: t(`modes.${id}.p`),
}));

// Tab glyphs are the extension's own mode icons (SidebarUI ICONS), plus a
// bookmark for the dictionary — the same shapes the visitor will meet in the
// panel after installing.
const TAB_ICON = {
  dual: '<rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13.5" width="18" height="6" rx="1.5"/>',
  guess: '<rect x="3" y="5" width="18" height="6" rx="1.5"/><circle cx="6.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/>',
  single: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 14.5h12"/>',
  save: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.5L6 20V5a1 1 0 0 1 1-1z"/>',
};

const modes = (t) => `
<div class="mslider" id="mode-slider" aria-label="Reading modes">
  <div class="mtabs" role="tablist">
    ${slides(t).map((s) => `
    <button type="button" class="mtab" role="tab" data-slide="${s.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[s.id]}</svg>
      <span>${esc(s.tab)}</span>
    </button>`).join('')}
  </div>
  <div class="mslides">
    ${slides(t).map((s) => `
    <article class="mslide" data-slide="${s.id}">
      <span class="mviz" aria-hidden="true">${viz[s.id]}
        <span class="viz-progress"><i></i></span>
      </span>
      <div class="mtext">
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.body)}</p>
      </div>
    </article>`).join('')}
  </div>
</div>`;

const qa = (items) => items.map((f) => `
  <details class="qa">
    <summary>${esc(f.q)}</summary>
    <p>${esc(f.a)}</p>
  </details>`).join('');

const globalFaq = (t) => ['free', 'languages', 'edition', 'words'].map((k) => ({
  q: t(`faq.${k}.q`), a: t(`faq.${k}.a`),
}));

// Right-to-left locales. Without dir="rtl" the browser still SHAPES the text
// correctly (Unicode bidi handles each run) but lays the BLOCK out
// left-to-right: headings and nav sit against the wrong margin and a
// sentence's final period lands at the far left. Keyed by htmlLang, the
// value that actually reaches the <html> tag.
const RTL_LANGS = new Set(['ar', 'he', 'fa']);

// `scripts` overrides the default page scripts (main.js + demo.js). The auth
// pages pass their own set so they don't pull the demo bundle. `extraHead`
// injects extra <head> markup (auth pages set window.LINGOGRAM_APP_URL).
// `hrefLang`: every OTHER locale's URL for this same page, keyed by BCP-47
// tag — self-referencing hreflang plus x-default (English) tell search
// engines these paths are translations of one another rather than duplicate
// content, and to default unmatched visitors to English.
const layout = ({ lang, htmlLang, title, description, pathName, body, scripts, extraHead, hrefLang }) => `<!doctype html>
<html lang="${htmlLang}"${RTL_LANGS.has(htmlLang) ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE.domain}${pathName}">
${Object.entries(hrefLang || {}).map(([tag, href]) => `<link rel="alternate" hreflang="${tag}" href="${SITE.domain}${href}">`).join('\n')}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE.domain}${pathName}">
<meta property="og:type" content="website">
<link rel="icon" href="/logo.png" type="image/png">
<link rel="stylesheet" href="/site.css?v=${BUST}">
${extraHead || ''}</head>
<body>
${body}
${scripts || `<script src="/main.js?v=${BUST}" defer></script>
<script src="/demo.js?v=${BUST}" defer></script>`}
</body>
</html>`;

// ---------------------------------------------------------------- pages

// The cards are install links: they go straight to the Chrome Web Store, not
// to the /<slug>/ landing pages. Netflix and YouTube share one listing (the
// YouTube extension matches netflix.com too), so both cards resolve to the
// same URL — which is correct, not a bug: either card installs what its site
// needs. Edition name (editions.json) is English-only for now — see the i18n
// rollout note at the top of this file. The one-line card blurb is
// localized (i18n editionsCard.<mark>): it renders on every locale's home
// page, unlike the full /<slug>/ landing pages which stay English.
const editionCards = (t, lang) => EDITIONS.editions.map((ed) => `
  <a class="ed" href="${storeHref(ed.storeUrl, lang)}"${ed.storeUrl ? ' rel="noopener"' : ''}>
    ${mark(ed.mark)}
    <span class="ed-t"><b>${esc(ed.name)}</b><span>${esc(t(`editionsCard.${ed.mark}`))}</span><span class="go">${esc(t('home.editionGo'))}</span></span>
  </a>`).join('') + `
  <a class="ed ed-soon" href="mailto:${SITE.supportEmail}?subject=${encodeURIComponent('Site suggestion for Lingogram')}">
    <span class="mark" aria-hidden="true">＋</span>
    <span class="ed-t"><b>${esc(t('home.editionSoonTitle'))}</b><span>${esc(t('home.editionSoonBody'))}</span><span class="go">${esc(t('home.editionSoonCta'))}</span></span>
  </a>`;

const homePage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: SITE.title,
    description: SITE.description,
    pathName: `${root}/`,
    body: `
<div class="wrap-outer">
${header(t, root)}
<main>
  <div class="wrap">
    <!-- No eyebrow above the h1: the pill that used to sit here ("Free ·
         YouTube · Netflix · HDrezka") was 12px uppercase above a 62px
         headline, so the eye skipped it. The three sites now name themselves
         as tabs on the demo card below, and "free" is still carried by the
         CTA and the proof line under it. -->
    <section class="hero" style="padding-top:32px">
      <h1>${esc(t('home.h1Lead'))}<br><span class="pop">${esc(t('home.h1Pop'))}</span></h1>
      <!-- One lede, not a feature list: it names the choice of how to study
           (dual subs vs. listen-first reveal) and the dictionary. The demo
           below and the feature cards still carry the proof. -->
      <p class="sub">${esc(t('home.heroLede'))}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${storeHref(EDITIONS.primary.storeUrl, lang)}">${CHROME_ICON}${esc(t('home.ctaPrimary'))}</a>
        <a class="btn btn-ghost" href="#platforms">${esc(t('home.ctaSecondary'))}</a>
      </div>
      ${proof(t)}
      ${demo(t, 'youtube')}
    </section>

    <section id="platforms">
      <span class="kicker">${esc(t('home.platformsKicker'))}</span>
      <h2>${esc(t('home.platformsH2'))}</h2>
      <p class="lede">${esc(t('home.platformsLede'))}</p>
      <div class="editions">${editionCards(t, lang)}</div>
    </section>

    <section id="how">
      <span class="kicker">${esc(t('home.howKicker'))}</span>
      <h2>${esc(t('home.howH2'))}</h2>
      <div class="steps">
        <div class="step"><span class="step-n">1</span><b>${esc(t('home.step1T'))}</b><p>${esc(t('home.step1D'))}</p></div>
        <div class="step"><span class="step-n">2</span><b>${esc(t('home.step2T'))}</b><p>${esc(t('home.step2D'))}</p></div>
        <div class="step"><span class="step-n">3</span><b>${esc(t('home.step3T'))}</b><p>${esc(t('home.step3D'))}</p></div>
      </div>
    </section>
  </div>

  <div class="band" id="dictionary">
    <div class="wrap">
      <span class="kicker">${esc(t('home.dictKicker'))}</span>
      <h2>${esc(t('home.dictH2'))}</h2>
      <p class="lede">${esc(t('home.dictLede'))}</p>
      <div class="dict">
        <div class="dict-head"><b>${esc(t('home.dictMyWords'))}</b><span class="dict-count">${esc(t('home.dictCount'))}</span></div>
        <div class="dict-card">
          <div class="dict-w"><b>${esc(t('home.dictWord1'))}</b><span class="dict-tr">${esc(t('home.dictTr1'))}</span><span class="dict-src">${mark('yt', true)}${esc(t('editionsMap.yt'))}</span></div>
          <p class="dict-ctx">${t('home.dictCtx1', { w: `<mark>${esc(t('home.dictWord1'))}</mark>` })}</p>
        </div>
        <div class="dict-card">
          <div class="dict-w"><b>${esc(t('home.dictWord2'))}</b><span class="dict-tr">${esc(t('home.dictTr2'))}</span><span class="dict-src">${mark('nf', true)}${esc(t('editionsMap.nf'))}</span></div>
          <p class="dict-ctx">${t('home.dictCtx2', { w: `<mark>${esc(t('home.dictWord2'))}</mark>` })}</p>
        </div>
        <div class="dict-card">
          <div class="dict-w"><b>${esc(t('home.dictWord3'))}</b><span class="dict-tr">${esc(t('home.dictTr3'))}</span><span class="dict-src">${mark('hd', true)}${esc(t('editionsMap.hd'))}</span></div>
          <p class="dict-ctx">${t('home.dictCtx3', { w: `<mark>${esc(t('home.dictWord3'))}</mark>` })}</p>
        </div>
        <div class="dict-foot">${t('home.dictFoot', { b: `<b>${esc(t('home.dictFootBold'))}</b>` })}</div>
      </div>
    </div>
  </div>

  <div class="wrap">
    <section id="features" style="padding-top:0; margin-top:76px">
      <span class="kicker">${esc(t('home.featKicker'))}</span>
      <h2>${esc(t('home.featH2'))}</h2>
      <p class="lede">${esc(t('home.featLede'))}</p>
      <div class="features">
        <div class="feat"><span class="tag">${esc(t('home.feat1Tag'))}</span><h3>${esc(t('home.feat1H'))}</h3><p>${esc(t('home.feat1P'))}</p></div>
        <div class="feat"><span class="tag">${esc(t('home.feat2Tag'))}</span><h3>${esc(t('home.feat2H'))}</h3><p>${esc(t('home.feat2P'))}</p></div>
        <div class="feat"><span class="tag">${esc(t('home.feat3Tag'))}</span><h3>${esc(t('home.feat3H'))}</h3><p>${t('home.feat3P', { kbd: '<kbd>Shift + G</kbd>' })}</p></div>
        <div class="feat"><span class="tag">${esc(t('home.feat4Tag'))}</span><h3>${esc(t('home.feat4H'))}</h3><p>${t('home.feat4P', { link: `<a href="#dictionary">${esc(t('home.feat4Link'))}</a>` })}</p></div>
      </div>
    </section>

    <section id="privacy">
      <span class="kicker">${esc(t('home.privKicker'))}</span>
      <h2>${esc(t('home.privH2'))}</h2>
      <div class="privacy">
        <div class="cell"><span>${t('home.priv1', { b: `<b>${esc(t('home.priv1Bold'))}</b>` })}</span></div>
        <div class="cell"><span>${t('home.priv2', { b: `<b>${esc(t('home.priv2Bold'))}</b>` })}</span></div>
        <div class="cell"><span>${t('home.priv3', { b: `<b>${esc(t('home.priv3Bold'))}</b>` })}</span></div>
        <div class="cell"><span>${t('home.priv4', { b: `<b>${esc(t('home.priv4Bold'))}</b>` })}</span></div>
      </div>
    </section>

    <section id="faq">
      <span class="kicker">${esc(t('home.faqKicker'))}</span>
      <h2>${esc(t('home.faqH2'))}</h2>
      ${qa(globalFaq(t))}
    </section>

    <section class="final">
      <span class="logo-mark">${CHAMELEON(40)}</span>
      <h2>${esc(t('home.finalH2'))}</h2>
      <div class="cta-row" style="margin-top:22px">
        <a class="btn btn-primary" href="${storeHref(EDITIONS.primary.storeUrl, lang)}">${CHROME_ICON}${esc(t('home.finalCta'))}</a>
      </div>
      <p class="proof">${esc(t('home.finalProof'))}</p>
    </section>
  </div>
</main>
${footer(t, root)}
</div>`,
  });
};

// Edition pages (editions.json copy: name/hero/points/faq) are English-only
// for now — see the i18n rollout note at the top of this file. They still
// render the localized header/footer chrome via the English dictionary, so
// the language switcher is present and consistent even here.
const editionPage = (ed) => {
  const t = makeT(EN_STRINGS);
  return layout({
    lang: 'en', htmlLang: 'en',
    title: `${ed.name} — dual subtitles on ${ed.site}`,
    description: ed.sub,
    pathName: `/${ed.slug}/`,
    body: `
${header(t, '')}
<main>
  <div class="wrap">
    <section class="hero" style="padding-top:32px">
      <span class="eyebrow">Lingogram for ${esc(ed.site)}</span>
      <h1>${esc(ed.heroLead)}<br><span class="pop">${esc(ed.heroPop)}</span></h1>
      <p class="sub">${esc(ed.sub)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${storeHref(ed.storeUrl, 'en')}">${CHROME_ICON}${esc(t('edition.ctaPrimary'))}</a>
        <a class="btn btn-ghost" href="/#platforms">${esc(t('edition.ctaSecondary'))}</a>
      </div>
      ${proof(t)}
      ${demo(t, ed.slug)}
    </section>

    <section>
      <span class="kicker">${esc(t('edition.builtKicker', { site: ed.site }))}</span>
      <h2>${esc(t('edition.builtH2', { site: ed.site }))}</h2>
      <div class="steps">
        ${ed.points.map((p, i) => `
        <div class="step"><span class="step-n">${i + 1}</span><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}
      </div>
    </section>

    <section id="faq">
      <span class="kicker">FAQ</span>
      <h2>${esc(t('edition.faqH2'))}</h2>
      ${qa([...ed.faq, ...globalFaq(t).filter((f) => f.q !== t('faq.languages.q'))])}
    </section>

    <section class="final">
      <span class="logo-mark">${CHAMELEON(40)}</span>
      <h2>${esc(t('edition.finalH2', { site: ed.site }))}</h2>
      <div class="cta-row" style="margin-top:22px">
        <a class="btn btn-primary" href="${storeHref(ed.storeUrl, 'en')}">${CHROME_ICON}${esc(t('edition.finalCta', { name: ed.name }))}</a>
      </div>
      <p class="proof">${esc(t('edition.finalProof'))}</p>
    </section>
  </div>
</main>
${footer(t, '')}`,
  });
};

// Minimal markdown renderer — enough for the privacy policy (headings, bold,
// links, bullet lists, horizontal rules, paragraphs).
const md = (text) => {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { blocks.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('\n')}</ul>`); list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const li = line.match(/^[*-]\s+(.*)/);
    if (li) { flushPara(); (list ||= []).push(li[1]); continue; }
    if (line === '') { flushPara(); flushList(); continue; }
    if (list) { list[list.length - 1] += ' ' + line; continue; } // wrapped list item
    if (/^---+$/.test(line)) { flushPara(); blocks.push('<hr>'); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { flushPara(); blocks.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    para.push(line.replace(/^>\s?/, ''));
  }
  flushPara(); flushList();
  return blocks.join('\n');
};

// The English body is the LEGAL source of truth, read straight from
// apps/youtube/PRIVACY_POLICY.md (single source until a family-wide policy
// is written — see the file header). Other locales are a translated COPY
// committed under src/data/privacy/<lang>.md: translating a legal document
// is not something to regenerate casually on every edit of the English
// original, so these are static files a human updates, not a live mirror.
// A locale without a translated copy falls back to the English body rather
// than 404ing or omitting the page.
const PRIVACY_DIR = path.join(SRC, 'data', 'privacy');
const privacyBody = (lang) => {
  const translated = path.join(PRIVACY_DIR, `${lang}.md`);
  if (lang !== 'en' && fs.existsSync(translated)) return fs.readFileSync(translated, 'utf8');
  return fs.readFileSync(path.join(HERE, '..', 'youtube', 'PRIVACY_POLICY.md'), 'utf8');
};

const privacyPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('privacy.title'),
    description: t('privacy.description'),
    pathName: `${root}/privacy/`,
    body: `${header(t, root)}<main><article class="doc">${md(privacyBody(lang))}</article></main>${footer(t, root)}`,
  });
};

// ------------------------------------------------------------- /languages/
//
// The full picker as a PAGE, for phones and tablets: the header's popover
// (see wireLangSwitch in src/demo/index.ts) is a desktop control — 42 names
// never fit a panel hung off a pill in a 375px header. Narrow viewports get
// a link here instead, where the list has the whole screen.
//
// Region groups, not one alphabetical run of 42: someone hunting for Polish
// scans a block of fifteen, not the whole list. Sorted by autonym at render
// time so it collates in the READING locale.
const LANGUAGE_REGIONS = [
  { key: 'westEurope', codes: ['en', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'sv', 'no', 'da', 'fi'] },
  { key: 'eastEurope', codes: ['pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'sr', 'uk', 'ru', 'lt', 'lv', 'et', 'el'] },
  { key: 'asia', codes: ['zh', 'ja', 'ko', 'hi', 'bn', 'ta', 'te', 'th', 'vi', 'id', 'ms', 'fil'] },
  { key: 'middleEast', codes: ['ar', 'he', 'fa', 'tr'] },
];

// English names for the gloss beside each autonym ("Deutsch — German"), so a
// visitor who cannot read a script can still find their language, and so
// search matches "german" as readily as "deutsch". Deliberately NOT in i18n/:
// one fixed English table, not per-locale copy, and the key-parity check
// would otherwise demand all 42 locales carry a copy of it.
const ENGLISH_NAMES = JSON.parse(
  fs.readFileSync(path.join(SRC, 'data', 'language-names.json'), 'utf8'),
);

const languagesPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;

  // Every locale must sit in exactly one region — an unplaced one would be
  // silently unreachable from this page.
  const placed = LANGUAGE_REGIONS.flatMap((r) => r.codes);
  const missing = LOCALES.map((l) => l.code).filter((c) => !placed.includes(c));
  const unknown = placed.filter((c) => !LOCALES.some((l) => l.code === c));
  if (missing.length || unknown.length) {
    throw new Error(
      'LANGUAGE_REGIONS is out of sync with i18n/' +
      (missing.length ? `\n  unplaced locales: ${missing.join(', ')}` : '') +
      (unknown.length ? `\n  regions name locales that do not exist: ${unknown.join(', ')}` : ''),
    );
  }

  const collator = new Intl.Collator(strings.meta.htmlLang);
  const entryFor = (code) => {
    const target = LOCALES.find((l) => l.code === code);
    const name = target.strings.meta.name;
    const gloss = ENGLISH_NAMES[code];
    const showGloss = gloss && gloss.toLowerCase() !== name.toLowerCase();
    const to = code === 'en' ? '/' : `/${code}/`;
    // data-search carries everything the filter matches on — autonym,
    // English name, code — so main.js needs no locale table of its own.
    const haystack = `${name} ${gloss || ''} ${code}`.toLowerCase();
    return `<a class="lang-entry${code === lang ? ' is-current' : ''}" href="${to}" lang="${target.strings.meta.htmlLang}"${code === lang ? ' aria-current="true"' : ''} data-search="${esc(haystack)}">
      <span class="le-name">${esc(name)}</span>${showGloss ? `<span class="le-en" lang="en">${esc(gloss)}</span>` : ''}
    </a>`;
  };

  const regions = LANGUAGE_REGIONS.map((region) => {
    const sorted = [...region.codes].sort((a, b) => collator.compare(
      LOCALES.find((l) => l.code === a).strings.meta.name,
      LOCALES.find((l) => l.code === b).strings.meta.name,
    ));
    return `<section class="lang-region" data-region>
      <h2>${esc(t(`languages.region.${region.key}`))}</h2>
      <div class="lang-grid">${sorted.map(entryFor).join('')}</div>
    </section>`;
  }).join('');

  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('languages.title'),
    description: t('languages.description'),
    pathName: `${root}/languages/`,
    body: `
${header(t, root)}
<main class="wrap lang-page">
  <div class="lang-head">
    <h1>${esc(t('languages.h1'))}</h1>
    <p class="sub">${t('languages.lede', { n: LOCALES.length.toLocaleString(strings.meta.htmlLang) })}</p>
  </div>
  <p class="lang-current-row">${t('languages.reading', { lang: `<b>${esc(strings.meta.name)}</b>` })}</p>
  <!-- main.js injects the search field here: with JS off the grouped list
       below is fully usable, and no dead input is left promising a filter
       that cannot run. -->
  <div id="lang-search-host" data-search-label="${esc(t('languages.searchPlaceholder'))}" data-clear-label="${esc(t('languages.clearSearch'))}" data-empty="${esc(t('languages.noMatch'))}" data-empty-hint="${esc(t('languages.noMatchHint'))}"${countAttrs(strings.languages.count)}></div>
  <div id="lang-regions">${regions}</div>
</main>
${footer(t, root)}`,
  });
};

const editionsMap = JSON.stringify(
  Object.fromEntries(EDITIONS.editions.map((e) => [e.slug, e.name])),
);

// welcome/uninstall are reached from the extension (chrome.runtime.onInstalled
// / setUninstallURL — not wired up in any of the three extensions yet, but the
// pages are edition-aware via ?ext=<slug> for when they are), so they render
// per locale exactly like the home page.
const welcomePage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('welcome.title'),
    description: t('welcome.description'),
    pathName: `${root}/welcome/`,
    body: `
${header(t, root)}
<main class="narrow">
  <span class="logo-mark" style="width:64px;height:64px;border-radius:18px;margin:20px auto">${CHAMELEON(40)}</span>
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em"><span data-ext-name>Lingogram</span> ${esc(t('welcome.h1'))}</h1>
  <p class="sub">${esc(t('welcome.sub'))}</p>
  <div class="steps">
    <div class="step"><span class="step-n">1</span><b>${esc(t('welcome.step1T'))}</b><p>${esc(t('welcome.step1D'))}</p></div>
    <div class="step"><span class="step-n">2</span><b>${esc(t('welcome.step2T'))}</b><p>${esc(t('welcome.step2D'))}</p></div>
    <div class="step"><span class="step-n">3</span><b>${esc(t('welcome.step3T'))}</b><p>${t('welcome.step3D', { link: `<a href="${SITE.appUrl}">${esc(t('welcome.step3Link'))}</a>` })}</p></div>
  </div>
  <div class="keys">
    <span><kbd>Shift + D</kbd> ${esc(t('welcome.keyDual'))}</span>
    <span><kbd>Shift + S</kbd> ${esc(t('welcome.keySwap'))}</span>
    <span><kbd>Shift + G</kbd> ${esc(t('welcome.keyGuess'))}</span>
    <span><kbd>Shift + O</kbd> ${esc(t('welcome.keyOverlay'))}</span>
  </div>
</main>
${footer(t, root)}
<script>window.__EDITIONS = ${editionsMap};</script>`,
  });
};

const uninstallPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('uninstall.title'),
    description: t('uninstall.description'),
    pathName: `${root}/uninstall/`,
    body: `
${header(t, root)}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">${esc(t('uninstall.h1'))}</h1>
  <p class="sub">${t('uninstall.sub', { ext: '<span data-ext-name>Lingogram</span>' })}</p>
  <form id="feedback-form" data-mailto="${SITE.supportEmail}">
    <textarea id="feedback-text" placeholder="${esc(t('uninstall.placeholder'))}" aria-label="${esc(t('uninstall.ariaLabel'))}"></textarea>
    <div class="cta-row" style="margin-top:16px">
      <button class="btn btn-primary" type="submit">${esc(t('uninstall.send'))}</button>
    </div>
  </form>
  <p class="sub" style="margin-top:34px;font-size:15px">${esc(t('uninstall.footPrefix'))} <a href="${SITE.appUrl}">${esc(t('uninstall.footLink'))}</a> ${esc(t('uninstall.footMid'))} <a href="${root}/#platforms">${esc(t('uninstall.reinstall'))}</a></p>
</main>
${footer(t, root)}
<script>window.__EDITIONS = ${editionsMap};</script>`,
  });
};

// The /words/ "coming soon" placeholder is gone: the dictionary web app has
// shipped. SITE.appUrl now points at /app/, served by the React SPA on its own
// Hosting site, and firebase.json 301s the old /words/ path onto it.

// ---------------------------------------------------------------- auth pages
//
// login/register live on the marketing site (not the SPA) so a visitor can
// sign up without loading the app bundle. The password never touches our
// backend: src/js/auth.js runs signUp / signInWithPassword against Firebase's
// REST surface, then calls auth-service (/auth/register, /auth/me) with the
// resulting ID token — the same model the extension uses.
//
// Google is different: signInWithPopup lives only in the Firebase Web SDK, so
// it ships as a separate ES-module bundle (auth-google.js, built by
// vite.auth.config.ts) loaded with type="module". auth-config.js runs first so
// window.LINGOGRAM_AUTH is set before either script reads it.
// auth.js and auth-google.js are ES-module bundles (built by vite.auth.config.ts
// from src/auth/*). auth-config.js runs first (classic script) so
// window.LINGOGRAM_AUTH is set before the modules read it.
const authScripts = `<script>window.LINGOGRAM_APP_URL=${JSON.stringify(SITE.appUrl)};</script>
<script src="/auth-config.js?v=${BUST}" defer></script>
<script src="/main.js?v=${BUST}" defer></script>
<script type="module" src="/auth.js?v=${BUST}"></script>
<script type="module" src="/auth-google.js?v=${BUST}"></script>`;

// Google button + "or" divider, shared by both forms. The button carries
// data-google-auth; auth-google.js finds it and wires signInWithPopup.
const googleAuth = (label) => `
    <button type="button" class="btn btn-ghost auth-google" data-google-auth>
      <svg class="auth-google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3 0-5.6-2-6.6-4.8H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.8v-3H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.4 6.8 9 4.8 12 4.8z"/></svg>
      ${label}
    </button>
    <div class="auth-divider"><span>or</span></div>`;

// Eye toggle SVG for the show/hide-password control.
const EYE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="eye-open" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle class="eye-open" cx="12" cy="12" r="3"/><path class="eye-off" d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3.9-.8" style="display:none"/></svg>`;

// A labelled field. `hint` renders a per-field error slot the JS fills on blur.
const field = (name, label, attrs) => `
      <label class="auth-field">
        <span>${label}</span>
        <input name="${name}" ${attrs}>
        <p class="auth-field-error" data-field-error="${name}"></p>
      </label>`;

// Password field with a show/hide toggle, a Caps-Lock hint, and (on register)
// an optional strength meter. The JS wires all three by data-attrs.
const passwordField = (label, attrs, withStrength) => `
      <label class="auth-field auth-pw">
        <span>${label}</span>
        <span class="auth-pw-wrap">
          <input name="password" type="password" ${attrs}>
          <button type="button" class="auth-pw-toggle" data-pw-toggle aria-label="Show password" aria-pressed="false">${EYE_ICON}</button>
        </span>
        <p class="auth-caps" data-caps-hint hidden>⇪ Caps Lock is on</p>
        ${withStrength ? `<span class="auth-strength" data-strength hidden><span class="auth-strength-bar"><span data-strength-fill></span></span><span class="auth-strength-label" data-strength-label></span></span>` : ''}
        <p class="auth-field-error" data-field-error="password"></p>
      </label>`;

const authShell = (t, root, eyebrow, inner, here) => `
${header(t, root, here)}
<main class="auth-wrap">
  <div class="auth-card">
    <span class="logo-mark auth-logo">${CHAMELEON(40)}</span>
    <span class="auth-eyebrow">${eyebrow}</span>
    ${inner}
  </div>
</main>
${footer(t, root)}`;

const registerPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('auth.register.title'),
    description: t('auth.register.description'),
    pathName: `${root}/register/`,
    scripts: authScripts,
    body: authShell(t, root, t('auth.register.eyebrow'), `
    <h1 class="auth-title">${joinFrags(esc(t('auth.register.h1Lead')), `<span class="pop">${esc(t('auth.register.h1Pop'))}</span>`)}</h1>
    <p class="auth-sub">${esc(t('auth.register.sub'))}</p>
    <form id="register-form" class="auth-form" novalidate>
      ${googleAuth(t('auth.register.googleCta'))}
      ${field('name', `${esc(t('auth.register.nameLabel'))} <span class="auth-optional">${esc(t('auth.optional'))}</span>`, `type="text" autocomplete="name" placeholder="${esc(t('auth.register.namePlaceholder'))}"`)}
      ${field('email', esc(t('auth.register.emailLabel')), `type="email" autocomplete="email" inputmode="email" placeholder="${esc(t('auth.register.emailPlaceholder'))}" required`)}
      ${passwordField(esc(t('auth.register.passwordLabel')), `autocomplete="new-password" placeholder="${esc(t('auth.register.passwordPlaceholder'))}" minlength="8" required`, true)}
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="${esc(t('auth.register.submitBusy'))}">${esc(t('auth.register.submit'))}</button>
    </form>
    <p class="auth-alt">${esc(t('auth.register.altPrefix'))} <a href="${root}/login/">${esc(t('auth.register.altLink'))}</a></p>
    <p class="auth-fine">${esc(t('auth.register.finePrefix'))} <a href="${root}/privacy/">${esc(t('auth.register.fineLink'))}</a>.</p>`, 'register'),
  });
};

const loginPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('auth.login.title'),
    description: t('auth.login.description'),
    pathName: `${root}/login/`,
    scripts: authScripts,
    body: authShell(t, root, t('auth.login.eyebrow'), `
    <h1 class="auth-title">${joinFrags(esc(t('auth.login.h1Lead')), `<span class="pop">${esc(t('auth.login.h1Pop'))}</span>`, esc(t('auth.login.h1Tail')))}</h1>
    <p class="auth-sub">${esc(t('auth.login.sub'))}</p>
    <form id="login-form" class="auth-form" novalidate>
      ${googleAuth(t('auth.login.googleCta'))}
      ${field('email', esc(t('auth.login.emailLabel')), `type="email" autocomplete="email" inputmode="email" placeholder="${esc(t('auth.login.emailPlaceholder'))}" required`)}
      ${passwordField(esc(t('auth.login.passwordLabel')), `autocomplete="current-password" placeholder="${esc(t('auth.login.passwordPlaceholder'))}" required`, false)}
      <div class="auth-row-end">
        <a href="#" id="reset-link" class="auth-link">${esc(t('auth.login.forgot'))}</a>
      </div>
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <p class="auth-note" id="reset-note">${esc(t('auth.login.resetNote'))}</p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="${esc(t('auth.login.submitBusy'))}">${esc(t('auth.login.submit'))}</button>
    </form>
    <p class="auth-alt">${esc(t('auth.login.altPrefix'))} <a href="${root}/register/">${esc(t('auth.login.altLink'))}</a></p>`, 'login'),
  });
};

const notFoundPage = (locale) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang,
    title: t('notFound.title'),
    description: t('notFound.description'),
    pathName: `${root}/404.html`,
    body: `
${header(t, root)}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">${esc(t('notFound.h1'))}</h1>
  <p class="sub">${esc(t('notFound.sub'))}</p>
  <div class="cta-row"><a class="btn btn-primary" href="${root}/">${esc(t('notFound.cta'))}</a></div>
</main>
${footer(t, root)}`,
  });
};

// ---------------------------------------------------------------- build

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Counted rather than recomputed: a hardcoded total silently drifts the
  // moment a page is added or dropped, which is how it came to claim 9 while
  // writing 8.
  let pages = 0;
  const write = (rel, html) => {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    pages += 1;
  };

  // Every locale-independent page below renders once PER LOCALE: English
  // unprefixed at /, every other locale under /<lang>/ — full independent
  // pages, not a client-side switch, so search engines and no-JS visitors
  // get real localized HTML. One hreflang map per PAGE KIND (each page kind
  // has its own set of paths), shared by every locale's render of that page
  // (self-referencing entries are expected and required by the spec).
  const hrefLangFor = (pathOf) => Object.fromEntries([
    ...LOCALES.map(({ code }) => [code, pathOf(code)]),
    ['x-default', pathOf('en')],
  ]);
  const homeHrefLang = hrefLangFor((c) => (c === 'en' ? '/' : `/${c}/`));
  const welcomeHrefLang = hrefLangFor((c) => (c === 'en' ? '/welcome/' : `/${c}/welcome/`));
  const uninstallHrefLang = hrefLangFor((c) => (c === 'en' ? '/uninstall/' : `/${c}/uninstall/`));
  const privacyHrefLang = hrefLangFor((c) => (c === 'en' ? '/privacy/' : `/${c}/privacy/`));
  const languagesHrefLang = hrefLangFor((c) => (c === 'en' ? '/languages/' : `/${c}/languages/`));
  const loginHrefLang = hrefLangFor((c) => (c === 'en' ? '/login/' : `/${c}/login/`));
  const registerHrefLang = hrefLangFor((c) => (c === 'en' ? '/register/' : `/${c}/register/`));

  for (const locale of LOCALES) {
    const root = locale.code === 'en' ? '' : locale.code;
    write(path.join(root, 'index.html'), homePage(locale, homeHrefLang));
    write(path.join(root, 'welcome', 'index.html'), welcomePage(locale, welcomeHrefLang));
    write(path.join(root, 'uninstall', 'index.html'), uninstallPage(locale, uninstallHrefLang));
    write(path.join(root, 'privacy', 'index.html'), privacyPage(locale, privacyHrefLang));
    write(path.join(root, 'languages', 'index.html'), languagesPage(locale, languagesHrefLang));
    write(path.join(root, 'login', 'index.html'), loginPage(locale, loginHrefLang));
    write(path.join(root, 'register', 'index.html'), registerPage(locale, registerHrefLang));
    write(path.join(root, '404.html'), notFoundPage(locale));
  }
  // The header switcher's option list (src/demo/index.ts siteLocales): every
  // locale that actually has a page, sourced from i18n/ rather than
  // hardcoded, so the switcher never drifts from what LOCALES above just
  // wrote to disk.
  fs.writeFileSync(
    path.join(SRC, 'data', 'site-locales.json'),
    JSON.stringify(LOCALES.map(({ code }) => code).sort()) + '\n',
  );
  // Edition pages (editions.json copy) stay English-only for now — see the
  // i18n rollout note at the top of this file.
  for (const ed of EDITIONS.editions) write(path.join(ed.slug, 'index.html'), editionPage(ed));

  fs.copyFileSync(path.join(SRC, 'styles', 'site.css'), path.join(OUT, 'site.css'));
  fs.copyFileSync(path.join(SRC, 'js', 'main.js'), path.join(OUT, 'main.js'));
  fs.copyFileSync(path.join(SRC, 'js', 'auth-config.js'), path.join(OUT, 'auth-config.js'));
  // auth.js is emitted by vite.auth.config.ts (from src/auth/entry.ts), not copied.
  fs.copyFileSync(path.join(SRC, 'assets', 'favicon.svg'), path.join(OUT, 'favicon.svg'));
  fs.copyFileSync(path.join(SRC, 'assets', 'logo.png'), path.join(OUT, 'logo.png'));
  // Localized product stills shown in place of the live embed on phones
  // (src/demo/index.ts). Generated by scripts/prep-mobile-shots.mjs, committed.
  fs.cpSync(path.join(SRC, 'assets', 'shots'), path.join(OUT, 'shots'), { recursive: true });
  // The demo's fallback clip (*.mp4 is gitignored). It is the same NASA
  // "Cosmic Dawn" trailer the YouTube source plays, cut to the window the
  // subtitles cover (demo-subs.json windowEnd) so both sources show the same
  // 102 seconds. Keep the audio: the player has a volume control, and `-an`
  // would leave it turning a silent track. Regenerate if missing:
  //   ffmpeg -t 102 -i "Cosmic Dawn (Official NASA Trailer).mp4" \
  //     -vf scale=854:480 -c:v libx264 -crf 30 -preset slow \
  //     -c:a aac -b:a 96k -ac 2 \
  //     -movflags +faststart src/assets/demo-clip.mp4
  const clip = path.join(SRC, 'assets', 'demo-clip.mp4');
  if (fs.existsSync(clip)) fs.copyFileSync(clip, path.join(OUT, 'demo-clip.mp4'));
  else console.warn('warning: src/assets/demo-clip.mp4 missing — the demo\'s fallback video will 404 (see comment above for the ffmpeg command)');

  console.log(`built ${pages} pages → ${path.relative(process.cwd(), OUT)}`);
}

build();

if (process.argv.includes('--watch')) {
  console.log('watching src/ …');
  let timer;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); } catch (e) { console.error(e.message); }
    }, 120);
  });
}
