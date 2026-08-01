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

const flattenKeys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
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

const mark = (kind, small = false) => {
  const cls = `mark ${small ? 'mark-sm ' : ''}mark-${kind}`;
  const glyph = kind === 'nf' ? 'N' : kind === 'hd' ? 'HD' : '';
  return `<span class="${cls}" aria-hidden="true">${glyph}</span>`;
};

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
  <!-- Switches the LOCALE: a full navigation to the equivalent /<lang>/ page
       (see src/demo/index.ts wireLangSwitch), which also repaints the demo's
       language pair — the live demo's second track, the phone films, the
       miniatures' sample line all key off the same page locale. Filled and
       unhidden by demo.js so pages without the demo (auth) never show an
       empty control. The visible pill is .lang-face (full autonym on
       desktop, bare code on phones, where the header has no room for
       "Português"); the real <select> lies transparent on top so a tap still
       opens the platform's own picker — the right UI for a 42-item list on a
       touch screen. -->
  <span class="lang-wrap" hidden>
    <span class="lang-face" aria-hidden="true"><span class="lf-name"></span><span class="lf-code"></span></span>
    <select id="lang-switch" aria-label="Site language"></select>
  </span>
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

const demo = (t, url) => `
<div class="demo" id="demo">
  <div class="demo-chrome">
    <span class="dot" style="background:#ff5f57"></span>
    <span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span>
    <span class="url">${esc(url)}</span>
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

// `scripts` overrides the default page scripts (main.js + demo.js). The auth
// pages pass their own set so they don't pull the demo bundle. `extraHead`
// injects extra <head> markup (auth pages set window.LINGOGRAM_APP_URL).
// `hrefLang`: every OTHER locale's URL for this same page, keyed by BCP-47
// tag — self-referencing hreflang plus x-default (English) tell search
// engines these paths are translations of one another rather than duplicate
// content, and to default unmatched visitors to English.
const layout = ({ lang, htmlLang, title, description, pathName, body, scripts, extraHead, hrefLang }) => `<!doctype html>
<html lang="${htmlLang}">
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
// needs. Edition name/card copy (editions.json) is English-only for now —
// see the i18n rollout note at the top of this file.
const editionCards = (t) => EDITIONS.editions.map((ed) => `
  <a class="ed" href="${href(ed.storeUrl)}"${ed.storeUrl ? ' rel="noopener"' : ''}>
    ${mark(ed.mark)}
    <span class="ed-t"><b>${esc(ed.name)}</b><span>${esc(ed.card)}</span><span class="go">${esc(t('home.editionGo'))}</span></span>
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
    <section class="hero" style="padding-top:32px">
      <span class="eyebrow">${esc(t('home.eyebrow'))}</span>
      <h1>${esc(t('home.h1Lead'))}<br><span class="pop">${esc(t('home.h1Pop'))}</span></h1>
      <!-- No feature list here: the demo below shows the product, and the
           feature cards under it (Watch. Catch. Keep.) both claim AND prove
           the same three points — a text-only copy above would just duplicate
           them at their weakest. -->
      <div class="cta-row">
        <a class="btn btn-primary" href="${href(EDITIONS.primary.storeUrl)}">${CHROME_ICON}${esc(t('home.ctaPrimary'))}</a>
        <a class="btn btn-ghost" href="#platforms">${esc(t('home.ctaSecondary'))}</a>
      </div>
      ${proof(t)}
      ${demo(t, EDITIONS.primary.demoUrl)}
    </section>

    <section id="platforms">
      <span class="kicker">${esc(t('home.platformsKicker'))}</span>
      <h2>${esc(t('home.platformsH2'))}</h2>
      <p class="lede">${esc(t('home.platformsLede'))}</p>
      <div class="editions">${editionCards(t)}</div>
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
        <a class="btn btn-primary" href="${href(EDITIONS.primary.storeUrl)}">${CHROME_ICON}${esc(t('home.finalCta'))}</a>
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
        <a class="btn btn-primary" href="${href(ed.storeUrl)}">${CHROME_ICON}${esc(t('edition.ctaPrimary'))}</a>
        <a class="btn btn-ghost" href="/#platforms">${esc(t('edition.ctaSecondary'))}</a>
      </div>
      ${proof(t)}
      ${demo(t, ed.demoUrl)}
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
        <a class="btn btn-primary" href="${href(ed.storeUrl)}">${CHROME_ICON}${esc(t('edition.finalCta', { name: ed.name }))}</a>
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

// Privacy, welcome, uninstall and auth pages are English-only for now (see
// the i18n rollout note at the top of this file) — they still get the
// localized header/footer chrome so the language switcher stays consistent
// site-wide. `EN_T` is the shared English translator these pages close over.
const EN_T = makeT(EN_STRINGS);

const privacyPage = () => {
  const source = path.join(HERE, '..', 'youtube', 'PRIVACY_POLICY.md');
  const text = fs.readFileSync(source, 'utf8');
  return layout({
    lang: 'en', htmlLang: 'en',
    title: EN_T('privacy.title'),
    description: EN_T('privacy.description'),
    pathName: '/privacy/',
    body: `${header(EN_T, '')}<main><article class="doc">${md(text)}</article></main>${footer(EN_T, '')}`,
  });
};

const editionsMap = JSON.stringify(
  Object.fromEntries(EDITIONS.editions.map((e) => [e.slug, e.name])),
);

const welcomePage = () => layout({
  lang: 'en', htmlLang: 'en',
  title: EN_T('welcome.title'),
  description: EN_T('welcome.description'),
  pathName: '/welcome/',
  body: `
${header(EN_T, '')}
<main class="narrow">
  <span class="logo-mark" style="width:64px;height:64px;border-radius:18px;margin:20px auto">${CHAMELEON(40)}</span>
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em"><span data-ext-name>Lingogram</span> ${esc(EN_T('welcome.h1'))}</h1>
  <p class="sub">${esc(EN_T('welcome.sub'))}</p>
  <div class="steps">
    <div class="step"><span class="step-n">1</span><b>${esc(EN_T('welcome.step1T'))}</b><p>${esc(EN_T('welcome.step1D'))}</p></div>
    <div class="step"><span class="step-n">2</span><b>${esc(EN_T('welcome.step2T'))}</b><p>${esc(EN_T('welcome.step2D'))}</p></div>
    <div class="step"><span class="step-n">3</span><b>${esc(EN_T('welcome.step3T'))}</b><p>${EN_T('welcome.step3D', { link: `<a href="${SITE.appUrl}">${esc(EN_T('welcome.step3Link'))}</a>` })}</p></div>
  </div>
  <div class="keys">
    <span><kbd>Shift + D</kbd> ${esc(EN_T('welcome.keyDual'))}</span>
    <span><kbd>Shift + S</kbd> ${esc(EN_T('welcome.keySwap'))}</span>
    <span><kbd>Shift + G</kbd> ${esc(EN_T('welcome.keyGuess'))}</span>
    <span><kbd>Shift + O</kbd> ${esc(EN_T('welcome.keyOverlay'))}</span>
  </div>
</main>
${footer(EN_T, '')}
<script>window.__EDITIONS = ${editionsMap};</script>`,
});

const uninstallPage = () => layout({
  lang: 'en', htmlLang: 'en',
  title: EN_T('uninstall.title'),
  description: EN_T('uninstall.description'),
  pathName: '/uninstall/',
  body: `
${header(EN_T, '')}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">${esc(EN_T('uninstall.h1'))}</h1>
  <p class="sub">${EN_T('uninstall.sub', { ext: '<span data-ext-name>Lingogram</span>' })}</p>
  <form id="feedback-form" data-mailto="${SITE.supportEmail}">
    <textarea id="feedback-text" placeholder="${esc(EN_T('uninstall.placeholder'))}" aria-label="${esc(EN_T('uninstall.ariaLabel'))}"></textarea>
    <div class="cta-row" style="margin-top:16px">
      <button class="btn btn-primary" type="submit">${esc(EN_T('uninstall.send'))}</button>
    </div>
  </form>
  <p class="sub" style="margin-top:34px;font-size:15px">${esc(EN_T('uninstall.footPrefix'))} <a href="${SITE.appUrl}">${esc(EN_T('uninstall.footLink'))}</a> ${esc(EN_T('uninstall.footMid'))} <a href="/#platforms">${esc(EN_T('uninstall.reinstall'))}</a></p>
</main>
${footer(EN_T, '')}
<script>window.__EDITIONS = ${editionsMap};</script>`,
});

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

const authShell = (eyebrow, inner, here) => `
${header(EN_T, '', here)}
<main class="auth-wrap">
  <div class="auth-card">
    <span class="logo-mark auth-logo">${CHAMELEON(40)}</span>
    <span class="auth-eyebrow">${eyebrow}</span>
    ${inner}
  </div>
</main>
${footer(EN_T, '')}`;

const registerPage = () => layout({
  lang: 'en', htmlLang: 'en',
  title: EN_T('auth.register.title'),
  description: EN_T('auth.register.description'),
  pathName: '/register/',
  scripts: authScripts,
  body: authShell(EN_T('auth.register.eyebrow'), `
    <h1 class="auth-title">${esc(EN_T('auth.register.h1Lead'))} <span class="pop">${esc(EN_T('auth.register.h1Pop'))}</span></h1>
    <p class="auth-sub">${esc(EN_T('auth.register.sub'))}</p>
    <form id="register-form" class="auth-form" novalidate>
      ${googleAuth(EN_T('auth.register.googleCta'))}
      ${field('name', `${esc(EN_T('auth.register.nameLabel'))} <span class="auth-optional">${esc(EN_T('auth.optional'))}</span>`, `type="text" autocomplete="name" placeholder="${esc(EN_T('auth.register.namePlaceholder'))}"`)}
      ${field('email', esc(EN_T('auth.register.emailLabel')), `type="email" autocomplete="email" inputmode="email" placeholder="${esc(EN_T('auth.register.emailPlaceholder'))}" required`)}
      ${passwordField(esc(EN_T('auth.register.passwordLabel')), `autocomplete="new-password" placeholder="${esc(EN_T('auth.register.passwordPlaceholder'))}" minlength="8" required`, true)}
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="${esc(EN_T('auth.register.submitBusy'))}">${esc(EN_T('auth.register.submit'))}</button>
    </form>
    <p class="auth-alt">${esc(EN_T('auth.register.altPrefix'))} <a href="/login/">${esc(EN_T('auth.register.altLink'))}</a></p>
    <p class="auth-fine">${esc(EN_T('auth.register.finePrefix'))} <a href="/privacy/">${esc(EN_T('auth.register.fineLink'))}</a>.</p>`, 'register'),
});

const loginPage = () => layout({
  lang: 'en', htmlLang: 'en',
  title: EN_T('auth.login.title'),
  description: EN_T('auth.login.description'),
  pathName: '/login/',
  scripts: authScripts,
  body: authShell(EN_T('auth.login.eyebrow'), `
    <h1 class="auth-title">${esc(EN_T('auth.login.h1Lead'))} <span class="pop">${esc(EN_T('auth.login.h1Pop'))}</span> ${esc(EN_T('auth.login.h1Tail'))}</h1>
    <p class="auth-sub">${esc(EN_T('auth.login.sub'))}</p>
    <form id="login-form" class="auth-form" novalidate>
      ${googleAuth(EN_T('auth.login.googleCta'))}
      ${field('email', esc(EN_T('auth.login.emailLabel')), `type="email" autocomplete="email" inputmode="email" placeholder="${esc(EN_T('auth.login.emailPlaceholder'))}" required`)}
      ${passwordField(esc(EN_T('auth.login.passwordLabel')), `autocomplete="current-password" placeholder="${esc(EN_T('auth.login.passwordPlaceholder'))}" required`, false)}
      <div class="auth-row-end">
        <a href="#" id="reset-link" class="auth-link">${esc(EN_T('auth.login.forgot'))}</a>
      </div>
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <p class="auth-note" id="reset-note">${esc(EN_T('auth.login.resetNote'))}</p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="${esc(EN_T('auth.login.submitBusy'))}">${esc(EN_T('auth.login.submit'))}</button>
    </form>
    <p class="auth-alt">${esc(EN_T('auth.login.altPrefix'))} <a href="/register/">${esc(EN_T('auth.login.altLink'))}</a></p>`, 'login'),
});

const notFoundPage = () => layout({
  lang: 'en', htmlLang: 'en',
  title: EN_T('notFound.title'),
  description: EN_T('notFound.description'),
  pathName: '/404.html',
  body: `
${header(EN_T, '')}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">${esc(EN_T('notFound.h1'))}</h1>
  <p class="sub">${esc(EN_T('notFound.sub'))}</p>
  <div class="cta-row"><a class="btn btn-primary" href="/">${esc(EN_T('notFound.cta'))}</a></div>
</main>
${footer(EN_T, '')}`,
});

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

  // The home page renders once PER LOCALE: English unprefixed at /, every
  // other locale under /<lang>/ — a full independent page, not a
  // client-side switch, so search engines and no-JS visitors get real
  // localized HTML. hreflang map built once, shared by every locale's page
  // (self-referencing entries are expected and required by the spec).
  const homeHrefLang = Object.fromEntries([
    ...LOCALES.map(({ code }) => [code, code === 'en' ? '/' : `/${code}/`]),
    ['x-default', '/'],
  ]);
  for (const locale of LOCALES) {
    const root = locale.code === 'en' ? '' : locale.code;
    write(path.join(root, 'index.html'), homePage(locale, homeHrefLang));
  }
  for (const ed of EDITIONS.editions) write(path.join(ed.slug, 'index.html'), editionPage(ed));
  write(path.join('privacy', 'index.html'), privacyPage());
  write(path.join('welcome', 'index.html'), welcomePage());
  write(path.join('uninstall', 'index.html'), uninstallPage());
  write(path.join('login', 'index.html'), loginPage());
  write(path.join('register', 'index.html'), registerPage());
  write('404.html', notFoundPage());

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
