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
import { loadLingogramLimits, assertSourceAllowed } from '../../packages/shared/vite-limits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const OUT = path.join(HERE, 'build');

const SITE = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'site.json'), 'utf8'));
const EDITIONS = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'editions.json'), 'utf8'));

// The same canonical caps the extensions build against — /uninstall/ writes
// into the very Firestore collection the in-product rating card does, so its
// byte ceiling has to be the rules' ceiling and not a second guess.
const LIMITS = loadLingogramLimits();
// The `source` this site stamps on those docs. Rules pin `source` to an
// allow-list, so a value missing from it makes every write fail with a
// PERMISSION_DENIED that looks like an outage — fail the BUILD instead.
const SITE_FEEDBACK_SOURCE = 'site-uninstall';
assertSourceAllowed(LIMITS, SITE_FEEDBACK_SOURCE);

// Cache-buster: python http.server sends no Cache-Control, so browsers may
// keep serving stale css/js after a rebuild. New value every build.
const BUST = Date.now().toString(36);

// Sign-in and sign-up are functional pages, not content: they carry nothing a
// searcher could want, and 42 localized copies of each would be 84 thin
// near-duplicates competing with the real pages. Kept out of sitemap.xml
// (INDEXABLE below) AND marked noindex here — a sitemap omission alone does
// not stop indexing, since crawlers still follow the links to them.
const NOINDEX = '<meta name="robots" content="noindex, follow">\n';

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

// What the third edition matches, read straight from its manifest so what
// this site claims cannot drift from the shipped build: the same source
// Chrome enforces, not a copy maintained here.
//
// `example` is the one preferred name+ending pair, chosen here (never in
// main.js) and validated against the enumerated pairs, shipped in the
// /welcome/ payload as two separate fields; main.js joins them at click time,
// so the payload itself holds no working address. `hosts` is the joined,
// enumerated list — it exists for the /help/addresses/ page, where the whole
// point is to show every covered address, as plain text and never as links.
//
// Both halves are load-bearing. The name has to be one of a handful, and the
// ending has to be one the manifest lists — endings are enumerated, not a
// wildcard, so a known name with an unlisted ending genuinely does not work.
// "Any ending is fine" would be a comfortable lie.
const REZKA_MATCH = (() => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', 'rezka', 'manifest.json'), 'utf8'),
  );
  const names = new Set();
  const zones = new Set();
  const pairs = new Map();
  for (const host of manifest.host_permissions || []) {
    const m = /^\*:\/\/\*\.([a-z-]+)\.(.+)\/\*$/.exec(host);
    if (!m || !/rezka/.test(m[1])) continue;
    names.add(m[1]);
    zones.add(m[2]);
    pairs.set(`${m[1]}.${m[2]}`, [m[1], m[2]]);
  }
  // Loud failure over a green build full of holes: if the manifest's
  // host_permissions ever change shape and the regex above stops matching,
  // every page built from this data would quietly claim zero coverage.
  if (pairs.size === 0) {
    throw new Error('apps/rezka/manifest.json yielded no rezka host pairs — did host_permissions change shape?');
  }
  // The shortest names stand for the hyphenated variants they prefix, so the
  // notice on /welcome/ can name two words instead of four.
  const sorted = [...names].sort();
  const prefixes = sorted.filter((n) => !sorted.some((o) => o !== n && n.startsWith(o)));
  // Ordered by name first, then ending, so the list page reads in blocks —
  // a plain sort would rank the hyphenated names above their own parent
  // ('-' sorts before '.').
  const hosts = [...pairs.entries()]
    .sort(([, a], [, b]) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1)))
    .map(([host]) => host);
  // The pairing people actually use — the same one the /welcome/ notice prints
  // and its button opens. The fallback picks the first enumerated pair, never a
  // free cross-join of names[0] and zones[0], which the manifest may not cover.
  const [exName, exZone] = pairs.get('hdrezka.ag') || pairs.get(hosts[0]);
  return { names: sorted, zones: [...zones].sort(), prefixes, hosts, example: { name: exName, zone: exZone } };
})();
// The extension-UI strings /help/analytics/ quotes (the popup's group heading
// and the checkbox label), read from the EXTENSION's own locale files at build
// time — the same principle as REZKA_MATCH above: quote the shipped source,
// never a copy maintained here that can silently drift when the popup is
// reworded. pt/zh map to the variant Chrome resolves for the larger share of
// those site locales' visitors; a missing locale or key fails the build.
const EXT_LOCALE_OF = { pt: 'pt_BR', zh: 'zh_CN' };
const EXT_UI = (() => {
  const dir = path.join(HERE, '..', 'youtube', '_locales');
  const cache = new Map();
  return (lang) => {
    const code = EXT_LOCALE_OF[lang] || lang;
    if (!cache.has(code)) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, code, 'messages.json'), 'utf8'));
      const group = m.ytGroupPrivacy?.message;
      const label = m.ytPrivacyAnalyticsLabel?.message;
      if (!group || !label) {
        throw new Error(`_locales/${code}/messages.json: ytGroupPrivacy or ytPrivacyAnalyticsLabel is missing`);
      }
      cache.set(code, { group, label });
    }
    return cache.get(code);
  };
})();

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

// The brand mark is the extension icon, downscaled into src/assets/logo.png.
// The 1254px master lives in apps/rezka/promo/icon1254.png — it is a listing
// asset, not a shipped one, and must stay out of src/assets/icons/, which is
// copied into both extensions wholesale. It already carries its own
// rounded-square backdrop, so .logo-mark is just a sizing box around it.
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
    <a href="${root}/help/analytics/">${esc(t('footer.helpAnalytics'))}</a>
    <a href="${root}/help/addresses/">${esc(t('footer.helpAddresses'))}</a>
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
        <div class="cell"><span>${t('home.priv1', {
          b: `<b>${esc(t('home.priv1Bold'))}</b>`,
          link: `<a href="${root}/help/analytics/">${esc(t('home.priv1Link'))}</a>`,
        })}</span></div>
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

// JSON destined for an inline <script>. JSON.stringify does not escape "</",
// and an HTML parser closes the block at the first `</script` inside it no
// matter how deeply quoted the JSON is — so a string carrying that sequence
// would end the script early and have its remainder parsed as markup. The
// welcome payload already ships literal markup (the <b> in welcome.ledeFor),
// which is exactly the kind of value that grows a closing tag later, so the
// escape belongs here rather than at each call site. < is inert inside a
// JSON string literal and parses back to "<".
const scriptJSON = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

const editionsMap = scriptJSON(
  Object.fromEntries(EDITIONS.editions.map((e) => [e.slug, e.name])),
);

// ----------------------------------------------------------------- welcome
//
// Reached from the extension right after install (chrome.runtime.onInstalled —
// not wired up in any of the three extensions yet, but the page is
// edition-aware via ?ext=<slug> for when they are), so it renders per locale
// exactly like the home page.
//
// This replaced a page that opened with three numbered steps. Those steps
// restated the home page's "How it works" almost verbatim — a re-pitch aimed at
// someone who had just installed and was already sold — and step 2 ("open a
// video with captions") was homework with no link attached, so the moment
// someone was most likely to try the thing was the moment they were left to
// figure out where. What replaced it:
//   - Thanks first, then a one-minute video instead of the steps.
//   - A real destination: the demoUrl already in editions.json.
//   - Edition-awareness that actually shows. ?ext= and the `data-ext-name` span
//     both predate this page and always worked, but the copy they fed named no
//     site at all, so every edition read identically. See EXT_SITES below.
//   - Privacy next to the sign-in ask, where the decision is made, rather than
//     only in the footer.
const WELCOME_VIDEO = 't2oye9CA7Vw';

// Per-edition page shape, keyed by editions.json slug.
//
// `covers` and `order` are deliberately NOT the same list:
//
//   covers — the sites this install actually works on, named in the headline
//     and the lede. The YouTube extension matches netflix.com too (one store
//     listing, both sites), so its visitors are Netflix visitors as often as
//     not and both names belong there. The HDrezka extension is a separate
//     listing that matches hdrezka only, so naming YouTube in ITS headline
//     would promise something the install cannot do.
//
//   order — the buttons, first one primary. HDrezka gets a YouTube button
//     anyway: not because the extension works there, but because it is the
//     one place we can guarantee a video with subtitles to check against.
//
// `covers` holds slugs rather than display names because the list that joins
// them is language-specific — "YouTube and Netflix" has to become "YouTube и
// Netflix" in Russian — so the pair is assembled per locale through
// welcome.sitesPair. Hardcoding the English "and" here leaked it into all 41
// translations once already.
const EXT_PAGES = {
  youtube: { covers: ['youtube', 'netflix'], order: ['youtube', 'netflix'] },
  netflix: { covers: ['netflix', 'youtube'], order: ['netflix', 'youtube'] },
  rezka: { covers: ['rezka'], order: ['rezka', 'youtube'] },
};

const welcomePage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  const bySlug = Object.fromEntries(EDITIONS.editions.map((e) => [e.slug, e]));

  // One "open it now" button per edition, primary first.
  //
  // The whole point of this page is that nobody leaves it wondering where to
  // try the thing, so a link that 404s would be worse than no link at all.
  // Only youtube's demoUrl in editions.json is still the `road-movie`
  // placeholder — it falls back to primary.demoUrl, which is a real video;
  // netflix has its own. Rezka's demoUrl is deliberately "" (documented in
  // editions.json): the empty string routes it to the deferred path below.
  // Point an edition's demoUrl at something real and it is used as-is.
  //
  // The third edition's control carries NO address in the markup, and no
  // joined address is stored anywhere on this site. It is a <button> marked
  // data-open-rezka, and main.js builds the address at click time by joining
  // the name and ending REZKA_MATCH ships as two separate fields. The button
  // behaves like the other two for the visitor; what the site ships is still
  // only the halves.
  const PLACEHOLDER = /road-movie/;
  const homeOf = { youtube: 'youtube.com', netflix: 'netflix.com' };
  const openUrl = (e) => {
    if (e.demoUrl && !PLACEHOLDER.test(e.demoUrl)) return e.demoUrl;
    if (e.slug === 'youtube' && EDITIONS.primary?.demoUrl &&
        !PLACEHOLDER.test(EDITIONS.primary.demoUrl)) return EDITIONS.primary.demoUrl;
    return homeOf[e.slug] || '';
  };

  const linkFor = (slug, primary) => {
    const e = bySlug[slug];
    if (!e) return '';
    const url = openUrl(e);
    const deferred = !url && slug === 'rezka';
    if (!url && !deferred) return '';
    // e.site is a brand name (YouTube / Netflix / HDrezka), so it is injected
    // into the localized "Open {site}" frame rather than translated.
    const note = t(`welcome.note.${slug}`);
    const cls = `wl-open${primary ? ' wl-open-primary' : ''}`;
    const inner = `
        ${mark(e.mark, true)}
        <span class="wl-open-body"><b>${esc(t('welcome.open', { site: e.site }))}</b><span>${esc(note)}</span></span>
        <svg class="wl-open-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      `;
    // The deferred one is a real <button>, not an href-less <a>: native focus
    // and Enter/Space activation with no role/tabindex/keydown shims. The
    // handler's own window.open is what carries the assembled address.
    return deferred
      ? `      <button type="button" class="${cls}" data-open-rezka>${inner}</button>`
      : `      <a class="${cls}" href="https://${esc(url)}" target="_blank" rel="noopener">${inner}</a>`;
  };

  const defaultOrder = ['youtube', 'netflix', 'rezka'];

  // The one pair REZKA_MATCH chose — the same one the button opens, joined
  // here only for display in the notice.
  const rezkaExample = `${REZKA_MATCH.example.name}.${REZKA_MATCH.example.zone}`;

  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('welcome.title'),
    description: t('welcome.description'),
    pathName: `${root}/welcome/`,
    body: `
${header(t, root)}
<main class="wl">
  <div class="wl-hello">
    <span class="logo-mark" style="width:44px;height:44px;border-radius:14px">${CHAMELEON(28)}</span>
    <span class="wl-hello-note">${t('welcome.hello')}</span>
  </div>

  <h1 class="wl-h1">${t('welcome.h1', { ext: '<span data-ext-name>Lingogram</span>' })}</h1>

  <p class="wl-lede">${t('welcome.lede', { b: `<b>${esc(t('welcome.ledeBold'))}</b>` })}</p>

  ${''/* Inside an inert <template>, not merely [hidden]: only the third
  edition's variant of this page should carry the notice at all, so main.js
  stamps it out for ?ext=rezka and every other variant keeps it out of the
  DOM — out of find-in-page, reader mode, and the no-JS render alike. */}
  <template id="wl-cover-tpl">
  <div class="wl-notice" id="wl-cover">
    <svg class="wl-notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
    <div class="wl-notice-body">
      <p>${t('welcome.coverage', {
        b: `<b>${esc(t('welcome.coverageBold'))}</b>`,
        // Neither the names nor the word joining them live in this template:
        // the names come from the extension's manifest at build time, the
        // conjunction from each locale's own strings.
        names: REZKA_MATCH.prefixes.map((p) => `<b>${esc(p)}</b>`)
          .join(` ${esc(t('welcome.coverageOr'))} `),
        // One address that works and one that does not — both plain text,
        // neither a link, both assembled from the two lists with the same
        // pairing main.js uses for the button. The counter-example is the
        // same pair with a suffix bolted onto the name: a near-miss, and its
        // job is to show the name has to match exactly, not approximately.
        yes: `<b>${esc(rezkaExample)}</b>`,
        no: `<b>${esc(rezkaExample.replace('.', '-1234.'))}</b>`,
        link: `<a href="${root}/help/addresses/">${esc(t('welcome.coverageLink'))}</a>`,
      })}</p>
    </div>
  </div>
  </template>

  <div class="wl-tut">
    <div id="wl-video">
      <button type="button" class="wl-facade" id="wl-facade" aria-label="${esc(t('welcome.playAria'))}">
        <img src="https://i.ytimg.com/vi/${WELCOME_VIDEO}/maxresdefault.jpg" alt="" width="1280" height="720" loading="lazy">
        <span class="wl-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
        <span class="wl-facade-meta"><span>${esc(t('welcome.seeHow'))}</span></span>
      </button>
    </div>
    <div class="wl-tut-foot">
      <span>${esc(t('welcome.oneMinute'))}</span>
      <a href="https://www.youtube.com/watch?v=${WELCOME_VIDEO}" target="_blank" rel="noopener">${esc(t('welcome.watchOnYt'))}</a>
    </div>
  </div>
  <p class="wl-note">${esc(t('welcome.playerNote'))}</p>

  <p class="wl-cta-h" id="wl-cta-h">${esc(t('welcome.ctaH'))}</p>
  <p class="wl-cta-s" id="wl-cta-s">${esc(t('welcome.ctaS'))}</p>
  <div class="wl-opens" id="wl-opens">
${defaultOrder.map((s, i) => linkFor(s, i === 0)).filter(Boolean).join('\n')}
  </div>

  <div class="wl-asides">
    <p id="wl-refresh">${t('welcome.reload', { b: `<b>${esc(t('welcome.reloadBold'))}</b>` })}</p>
    <p>${t('welcome.signIn', { b: `<b>${esc(t('welcome.signInBold'))}</b>` })}</p>
    <p>${t('welcome.langs', { b: `<b>${esc(t('welcome.langsBold'))}</b>` })}</p>
  </div>

  <!-- Privacy sits directly under the sign-in ask, because that is the moment
       someone is deciding whether to hand us anything. The three lines are the
       policy's own TL;DR, not marketing copy: without an account nothing
       leaves the device; signing in stores an email and the words you chose to
       save; nothing is sold. Kept as a <details> so it informs without
       becoming a wall in front of the first saved word. -->
  <details class="wl-priv">
    <summary>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>${esc(t('welcome.privSummary'))}</span>
      <svg class="wl-priv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </summary>
    <div class="wl-priv-body">
      <p>${t('welcome.priv1', {
        b: `<b>${esc(t('welcome.priv1Bold'))}</b>`,
        link: `<a href="${root}/help/analytics/">${esc(t('welcome.priv1Link'))}</a>`,
      })}</p>
      <p>${t('welcome.priv2', { b: `<b>${esc(t('welcome.priv2Bold'))}</b>` })}</p>
      <p>${t('welcome.priv3', { b: `<b>${esc(t('welcome.priv3Bold'))}</b>` })}</p>
      <p class="wl-priv-more"><a href="${root}/privacy/">${esc(t('welcome.privLink'))}</a></p>
    </div>
  </details>

  <div class="wl-keys">
    <p>${esc(t('welcome.keysIntro'))}</p>
    <div class="keys">
      <span><kbd>Shift + D</kbd> ${esc(t('welcome.keyDual'))}</span>
      <span><kbd>Shift + S</kbd> ${esc(t('welcome.keySwap'))}</span>
      <span><kbd>Shift + G</kbd> ${esc(t('welcome.keyGuess'))}</span>
      <span><kbd>Shift + O</kbd> ${esc(t('welcome.keyOverlay'))}</span>
    </div>
  </div>

  <p class="wl-signoff">${t('welcome.signoff', { link: `<a href="mailto:${SITE.supportEmail}">${esc(t('welcome.signoffLink'))}</a>` })}</p>
</main>
${footer(t, root)}
<script>window.__EDITIONS = ${editionsMap};
window.__WELCOME = ${scriptJSON({
  video: WELCOME_VIDEO,
  // Per-slug: the covered-site list already joined in this locale's own words,
  // plus the button order. Joining here rather than in main.js keeps that file
  // free of language rules — it ships once for all 42 locales.
  //
  // Every slug is resolved through editions.json and dropped if it isn't there,
  // so removing a record from that file (which its own comment invites) drops
  // the edition from this page instead of crashing the build.
  copy: Object.fromEntries(
    Object.entries(EXT_PAGES)
      .map(([slug, { covers, order }]) => {
        // The edition itself must exist, not just something it covers —
        // otherwise a removed record leaves a ?ext= entry pointing at a page
        // variant for an extension that no longer ships.
        if (!bySlug[slug]) return null;
        const names = covers.map((s) => bySlug[s]?.site).filter(Boolean);
        if (names.length === 0) return null;
        return [slug, {
          sites: names.length > 1
            ? t('welcome.sitesPair', { a: names[0], b: names[1] })
            : names[0],
          order: order.filter((s) => bySlug[s]),
        }];
      })
      .filter(Boolean),
  ),
  // Strings main.js swaps in for ?ext=. Passed from here so that file — one
  // bundle shared by all 42 locales — never holds English of its own.
  i18n: {
    // `{sites}` is filled client-side from copy[slug].sites above.
    h1: t('welcome.h1For'),
    lede: t('welcome.ledeFor', { b: `<b>${esc(t('welcome.ledeBold'))}</b>` }),
    rezkaCtaH: t('welcome.rezkaCtaH'),
    rezkaCtaS: t('welcome.rezkaCtaS'),
  },
  // The one chosen pair, kept as two fields main.js joins at click time —
  // see REZKA_MATCH.
  rezka: REZKA_MATCH.example,
})};</script>`,
  });
};

// ------------------------------------------------------- /help/analytics/
//
// The "how do I turn this off" page. Both places that admit we collect
// anonymous stats — welcome.priv1 and home.priv1 — link here rather than
// spelling out the steps inline: a privacy claim that says "you can turn it
// off" without saying HOW is the kind of promise that reads as evasion.
//
// The setting's own names are read from the EXTENSION's locale files at
// build time (EXT_UI above), not translated afresh here, so what this page
// tells someone to look for matches the popup they open character for
// character — and cannot drift when the popup is reworded. That is also why
// help.step2 takes the two names as placeholders instead of baking them into
// 42 translated sentences.
//
// The sidebar route to the same setting, shown rather than only described:
// the collapse tab opens the panel, the gear opens settings, the switch in
// the footer goes dark. One 9s loop, three taps, in the grammar of the home
// page's mode miniatures (see `viz` above) — a mock of a real surface, a
// ripple on the control being taught, a caption naming the resulting state.
// The written steps teach the toolbar-popup route; the drawing shows the
// in-page one — two doors to the same switch. aria-hidden with the <ol>
// below as the text alternative, so a screen reader gets an instruction and
// not a description of a drawing.
//
// Markup rather than a recorded GIF/webp on purpose: the label in here is
// the same extension string the steps below quote, so the drawing translates
// with the page instead of freezing English into 42 copies of a bitmap.
//
// Every measurement is the real one, from the extension's own stylesheet:
// the switch is 26×15 with an 11px knob travel, the accent is --vtt-accent,
// and the privacy row carries the lock icon and no group heading — the
// sidebar has none, unlike the popup. The collapse tab reuses TAB_CHEVRON:
// both miniatures draw the same real control (#vtt-toggle-btn).
const GEAR_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const LOCK_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

const analyticsViz = (t, ui) => `
<figure class="hviz" aria-hidden="true">
 <span class="hviz-scene">
  <span class="hviz-film">
    <span class="hviz-orb"></span>
    <span class="hviz-cap">${esc(VIZ_LINE)}<i data-viz-native>${esc(VIZ_NATIVE_FALLBACK)}</i></span>
  </span>
  <span class="hviz-side">
    <span class="hviz-tab">${TAB_CHEVRON}<span class="hviz-rip hviz-rip-tab"></span></span>
    <span class="hviz-head">
      <i class="hviz-logo"></i><i class="hviz-ghost"></i>
      <span class="hviz-gear">${GEAR_GLYPH}<span class="hviz-rip hviz-rip-gear"></span></span>
    </span>
    <span class="hviz-rows"><i></i><i></i><i></i></span>
    <span class="hviz-set">
      <span class="hviz-fake"><i></i></span>
      <span class="hviz-fake"><i class="hviz-short"></i></span>
      <span class="hviz-prow">
        ${LOCK_GLYPH}
        <span class="hviz-label">${esc(ui.label)}</span>
        <span class="hviz-sw"><span class="hviz-rip hviz-rip-sw"></span></span>
      </span>
    </span>
  </span>
  <span class="hviz-state hviz-state-on">${esc(t('help.analytics.stateOn'))}</span>
  <span class="hviz-state hviz-state-off">${esc(t('help.analytics.stateOff'))}</span>
 </span>
</figure>`;

const helpAnalyticsPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const ui = EXT_UI(lang);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('help.analytics.title'),
    description: t('help.analytics.description'),
    pathName: `${root}/help/analytics/`,
    body: `
${header(t, root)}
<main>
  <article class="doc">
    <h1>${esc(t('help.analytics.h1'))}</h1>
    <p>${esc(t('help.analytics.lede'))}</p>
    ${analyticsViz(t, ui)}
    <ol class="help-steps">
      <li>${esc(t('help.analytics.step1'))}</li>
      <li>${t('help.analytics.step2', {
        group: `<b>${esc(ui.group)}</b>`,
        label: `<b>${esc(ui.label)}</b>`,
      })}</li>
    </ol>
    <p>${t('help.analytics.after', {
      link: `<a href="${root}/privacy/">${esc(t('help.analytics.afterLink'))}</a>`,
    })}</p>
  </article>
</main>
${footer(t, root)}`,
  });
};

// ------------------------------------------------------- /help/addresses/
//
// The full list the /welcome/ notice links to. Every covered address, shown
// as plain text and never as links: the page is for recognizing your own
// address, not for navigating out. Generated from the extension's manifest
// at build time, so it moves with every release instead of rotting in copy.
const helpAddressesPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;
  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('help.addresses.title'),
    description: t('help.addresses.description'),
    pathName: `${root}/help/addresses/`,
    body: `
${header(t, root)}
<main>
  <article class="doc">
    ${''/* A real href, not a javascript: one — main.js upgrades it to
    history.back() only when the visitor arrived from this site, so a direct
    visit still has somewhere sensible to go. */}
    <a class="doc-back" href="${root}/welcome/?ext=rezka" data-back>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>${esc(t('help.addresses.back'))}
    </a>
    <h1>${esc(t('help.addresses.h1'))}</h1>
    <p>${t('help.addresses.lede', { n: REZKA_MATCH.hosts.length })}</p>
    <ul class="host-list">
${REZKA_MATCH.hosts.map((h) => `      <li>${esc(h)}</li>`).join('\n')}
    </ul>
    <p>${t('help.addresses.missing', {
      link: `<a href="mailto:${SITE.supportEmail}?subject=${encodeURIComponent(t('help.addresses.missingSubject'))}">${esc(t('help.addresses.missingLink'))}</a>`,
    })}</p>
  </article>
</main>
${footer(t, root)}`,
  });
};

// ------------------------------------------------------------- /uninstall/
//
// The page Chrome opens when someone removes the extension (setUninstallURL).
//
// The ask is a single tap, not a paragraph. An open textarea at the moment of
// uninstall answers from the few percent who were angry enough to type, which
// is the least representative slice there is; a reason chip is cheap enough
// that the merely-disappointed majority answers too. The textarea stays, but
// as optional depth under the chips rather than the whole question.
//
// Both halves land in ONE Firestore feedback doc (see src/js/main.js). The
// chip rides as a machine-readable "[reason:<id>]" prefix on `text` rather
// than its own field: the rules pin the doc to a fixed key set, so a new
// column would need a rules deploy, while a prefix aggregates by grep today.
// Same trick the extension already uses for a signed-out reply address.
const UNINSTALL_REASONS = ['subtitles', 'translation', 'setup', 'expected', 'oneoff', 'other'];

const uninstallPage = (locale, hrefLang) => {
  const { code: lang, strings } = locale;
  const t = makeT(strings);
  const root = lang === 'en' ? '' : `/${lang}`;

  // value= is the STABLE id, label is the translated text: the aggregate has
  // to survive both translation and copy edits, so nothing user-visible is
  // ever what gets counted.
  const chips = UNINSTALL_REASONS.map((id) => `
      <button type="button" class="uni-chip" data-reason="${id}" aria-pressed="false">
        <span class="uni-chip-tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
        ${esc(t(`uninstall.reason.${id}`))}
      </button>`).join('');

  return layout({
    lang, htmlLang: strings.meta.htmlLang, hrefLang,
    title: t('uninstall.title'),
    description: t('uninstall.description'),
    pathName: `${root}/uninstall/`,
    // auth-config.js, which the default layout does NOT ship: it is what
    // resolves projectId/firestoreUrl from the hostname, and the feedback
    // write below reads them. Both are `defer`, so auth-config.js is
    // guaranteed to have run before main.js looks for window.LINGOGRAM_AUTH.
    scripts: `<script src="/auth-config.js?v=${BUST}" defer></script>
<script src="/main.js?v=${BUST}" defer></script>`,
    body: `
${header(t, root)}
<main class="narrow uni">
  <h1 class="uni-h1">${esc(t('uninstall.h1'))}</h1>
  <p class="sub">${t('uninstall.sub', { ext: '<span data-ext-name>Lingogram</span>' })}</p>

  <!-- Without JS the chips are inert and the textarea would never unhide, so
       the page would silently swallow the one thing it exists to ask for. The
       no-JS branch drops the chips and hands back the plain mailto form the
       page used before — worse, but never a dead end. -->
  <noscript><style>
    .uni-chips { display: none; }
    /* Beats the [hidden] attribute's UA display:none. The attribute stays on
       the element, but with no JS there is nothing that would ever remove it
       and a visitor with assistive tech needs the form, not consistency. */
    .uni-more[hidden] { display: block !important; }
  </style></noscript>
  <form id="feedback-form" data-mailto="${SITE.supportEmail}"
        action="mailto:${SITE.supportEmail}" method="post" enctype="text/plain">
    <div class="uni-chips" role="group" aria-label="${esc(t('uninstall.ariaLabel'))}">${chips}
    </div>

    <!-- Above .uni-more, not below the form: the confirmation belongs next to
         the chips that produced it, not under a textarea nobody has touched —
         and on a phone that keeps it on the first screen. It also puts the
         live region ahead of the controls it describes. -->
    <p class="uni-status" data-status role="status" aria-live="polite"></p>

    <!-- Revealed once a reason is picked. The answer is already recorded by
         then, so this is an optional addition, not a step. -->
    <div class="uni-more" hidden>
      <textarea id="feedback-text" rows="3"
        placeholder="${esc(t('uninstall.detailHint'))}"
        aria-label="${esc(t('uninstall.detailHint'))}"></textarea>
      <div class="cta-row uni-actions">
        <button class="btn btn-primary" type="submit">${esc(t('uninstall.send'))}</button>
        <a class="uni-skip" href="${root}/">${esc(t('uninstall.skip'))}</a>
      </div>
    </div>
  </form>

  <p class="sub uni-foot">${esc(t('uninstall.footPrefix'))} <a href="${SITE.appUrl}">${esc(t('uninstall.footLink'))}</a> ${esc(t('uninstall.footMid'))} <a href="${root}/#platforms">${esc(t('uninstall.reinstall'))}</a></p>
</main>
${footer(t, root)}
<script>window.__EDITIONS = ${editionsMap};
window.__UNINSTALL = ${scriptJSON({
      i18n: {
        sending: t('uninstall.sending'),
        sent: t('uninstall.sent'),
        failed: t('uninstall.failed'),
        mailtoFallback: t('uninstall.mailtoFallback'),
      },
      maxBytes: LIMITS.MAX_FEEDBACK_TEXT_BYTES,
      source: SITE_FEEDBACK_SOURCE,
    })};</script>`,
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
const authScripts = `<script>window.LINGOGRAM_APP_URL=${scriptJSON(SITE.appUrl)};</script>
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
    extraHead: NOINDEX,
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
    extraHead: NOINDEX,
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
  const helpAnalyticsHrefLang = hrefLangFor((c) => (c === 'en' ? '/help/analytics/' : `/${c}/help/analytics/`));
  const helpAddressesHrefLang = hrefLangFor((c) => (c === 'en' ? '/help/addresses/' : `/${c}/help/addresses/`));
  const loginHrefLang = hrefLangFor((c) => (c === 'en' ? '/login/' : `/${c}/login/`));
  const registerHrefLang = hrefLangFor((c) => (c === 'en' ? '/register/' : `/${c}/register/`));

  for (const locale of LOCALES) {
    const root = locale.code === 'en' ? '' : locale.code;
    write(path.join(root, 'index.html'), homePage(locale, homeHrefLang));
    write(path.join(root, 'welcome', 'index.html'), welcomePage(locale, welcomeHrefLang));
    write(path.join(root, 'uninstall', 'index.html'), uninstallPage(locale, uninstallHrefLang));
    write(path.join(root, 'privacy', 'index.html'), privacyPage(locale, privacyHrefLang));
    write(path.join(root, 'languages', 'index.html'), languagesPage(locale, languagesHrefLang));
    write(path.join(root, 'help', 'analytics', 'index.html'), helpAnalyticsPage(locale, helpAnalyticsHrefLang));
    write(path.join(root, 'help', 'addresses', 'index.html'), helpAddressesPage(locale, helpAddressesHrefLang));
    write(path.join(root, 'login', 'index.html'), loginPage(locale, loginHrefLang));
    write(path.join(root, 'register', 'index.html'), registerPage(locale, registerHrefLang));
    write(path.join(root, '404.html'), notFoundPage(locale));
  }
  // ---- sitemap.xml + robots.txt ----
  //
  // Built from the SAME hreflang maps the pages above render from, so a new
  // locale or page kind cannot appear on disk while missing from the sitemap
  // — the drift a hand-written sitemap guarantees at 42 locales.
  //
  // Each URL carries the full <xhtml:link> alternates set, which is what tells
  // Google these 42 renders are translations rather than duplicates. That set
  // is exactly the hrefLang map, so the two can never disagree.
  //
  // login/register are excluded on purpose (see NOINDEX above). 404.html is
  // not a URL. Edition pages are English-only for now, so they get no
  // alternates — an empty map, not a fabricated per-locale one.
  const INDEXABLE = [
    homeHrefLang, welcomeHrefLang, uninstallHrefLang,
    privacyHrefLang, languagesHrefLang, helpAnalyticsHrefLang,
    helpAddressesHrefLang,
  ];
  const urlEntry = (loc, alternates) => `  <url>
    <loc>${SITE.domain}${loc}</loc>
${Object.entries(alternates).map(([tag, href]) =>
    `    <xhtml:link rel="alternate" hreflang="${tag}" href="${SITE.domain}${href}"/>`).join('\n')}
  </url>`;
  const sitemapUrls = [
    // One entry per locale per page kind: the hreflang map's values ARE the
    // locale URLs, so iterating it needs no second source.
    ...INDEXABLE.flatMap((alternates) =>
      LOCALES.map(({ code }) => urlEntry(alternates[code], alternates))),
    ...EDITIONS.editions.map((ed) => urlEntry(`/${ed.slug}/`, {})),
  ];
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapUrls.join('\n')}
</urlset>
`);
  // The SPA under /app is behind auth and renders client-side — nothing there
  // is indexable, and letting crawlers grind through it wastes crawl budget on
  // the pages that are. login/register are deliberately NOT disallowed here:
  // they carry noindex, and a crawler must be able to FETCH a page to read
  // that tag. Disallowing them instead would leave Google free to index them
  // from inbound links alone — the exact outcome the tag prevents.
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /app/

Sitemap: ${SITE.domain}/sitemap.xml
`);
  console.log(`sitemap: ${sitemapUrls.length} urls`);

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
