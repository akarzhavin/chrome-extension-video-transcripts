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

const navLinks = `
  <a href="/#platforms">Editions</a>
  <a href="/#how">How it works</a>
  <a href="/#dictionary">Your dictionary</a>
  <a href="/#faq">FAQ</a>`;

// `here` names the auth page we are ON ('login' | 'register'), so its own
// button can be dropped: offering "Log in" on /login/ is a link back to the
// page you are already reading, and following it wipes anything typed into
// the form. Dropping one also frees header room on narrow screens.
const header = (here) => `
<header class="site wrap">
  <a class="logo" href="/">
    <span class="logo-mark">${CHAMELEON(24)}</span>
    Lingogram
  </a>
  <nav class="top">${navLinks}</nav>
  ${here === 'login' ? '' : '<a class="btn btn-ghost btn-login" href="/login/">Log in</a>'}
  ${here === 'register' ? '' : '<a class="btn btn-primary btn-login" href="/register/">Sign up</a>'}
  <details class="mnav">
    <summary aria-label="Menu">☰</summary>
    <div class="mnav-panel">${navLinks}</div>
  </details>
</header>`;

const footer = () => `
<footer class="site wrap">
  <div class="f-col">
    <b>Lingogram</b>
    <span>© ${new Date().getFullYear()} Lingogram<br>Learn languages from what you watch.</span>
  </div>
  <div class="f-col">
    <b>Product</b>
    <a href="/#platforms">All editions</a>
    <a href="${SITE.appUrl}">Your dictionary</a>
    <a href="/#how">How it works</a>
  </div>
  <div class="f-col">
    <b>Help</b>
    <a href="/#faq">FAQ</a>
    <a href="mailto:${SITE.supportEmail}">Support</a>
    <a href="mailto:${SITE.supportEmail}?subject=${encodeURIComponent('Site suggestion for Lingogram')}">Suggest a site</a>
  </div>
  <div class="f-col">
    <b>Legal</b>
    <a href="/privacy/">Privacy policy</a>
  </div>
</footer>`;

// Proof strip renders only when the numbers are real (principle: page truth =
// product truth — no placeholder ratings on a public page).
const proof = () => {
  const p = SITE.proof || {};
  if (!p.rating || !p.users) return '';
  return `
  <p class="proof">
    <span><span class="stars">★★★★★</span> <b>${esc(p.rating)}</b> on Chrome Web Store</span>
    <span class="sep">•</span><span><b>${esc(p.users)}</b> learners</span>
    <span class="sep">•</span><span>Free, no ads</span>
  </p>`;
};

const demo = (url) => `
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
<p class="demo-hint">This is the extension itself, running here — <b>select a word</b> to save it, or try a mode below.<br><span class="demo-credit">Clip: NASA — <a href="https://www.nasa.gov/cosmic-dawn/" rel="noopener">Cosmic Dawn</a> (public domain)</span></p>
${modes()}`;

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

const SLIDES = [
  // "Dual subtitles" over plain "Dual": the tab is crawlable page copy, and
  // dual subtitles is the keyword the family is positioned on.
  { id: 'dual', tab: 'Dual subtitles', title: 'Both languages, at once',
    body: 'The line you hear next to the line you understand — no pausing, no switching tracks.' },
  { id: 'guess', tab: 'Guess', title: 'Click to reveal — and train your ear',
    body: 'The line stays hidden until you click it. Guess from listening first, then check yourself: the gap between the two is exactly where hearing improves.' },
  // The tab, not a mode switch: this slide narrates the overlay toggle, and
  // forcing displayMode 'single' unlit both mode chips in the demo's panel —
  // reading as "everything deactivated" while the miniature shows the mode
  // chip staying lit. demo/index.ts keeps the mode and pulses the on-video
  // captions instead (showOnScreen).
  { id: 'single', tab: 'On-screen', title: 'On screen, or in the sidebar — your call',
    body: 'Keep both lines over the film, where your eyes already are. Or take them off with one button and read from the panel instead, at your own pace. The subtitles never disappear — they just move.' },
  { id: 'save', tab: 'Dictionary', title: 'Keep every word you meet',
    body: 'Select a word — one tap saves it with the sentence it came from, straight to your dictionary on lingogram.ai.' },
];

// Tab glyphs are the extension's own mode icons (SidebarUI ICONS), plus a
// bookmark for the dictionary — the same shapes the visitor will meet in the
// panel after installing.
const TAB_ICON = {
  dual: '<rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13.5" width="18" height="6" rx="1.5"/>',
  guess: '<rect x="3" y="5" width="18" height="6" rx="1.5"/><circle cx="6.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/>',
  single: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 14.5h12"/>',
  save: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.5L6 20V5a1 1 0 0 1 1-1z"/>',
};

const modes = () => `
<div class="mslider" id="mode-slider" aria-label="Reading modes">
  <div class="mtabs" role="tablist">
    ${SLIDES.map((s) => `
    <button type="button" class="mtab" role="tab" data-slide="${s.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[s.id]}</svg>
      <span>${esc(s.tab)}</span>
    </button>`).join('')}
  </div>
  <div class="mslides">
    ${SLIDES.map((s) => `
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

// `scripts` overrides the default page scripts (main.js + demo.js). The auth
// pages pass their own set so they don't pull the demo bundle. `extraHead`
// injects extra <head> markup (auth pages set window.LINGOGRAM_APP_URL).
const layout = ({ title, description, pathName, body, scripts, extraHead }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE.domain}${pathName}">
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

const GLOBAL_FAQ = [
  { q: 'Is it free?', a: 'Yes. Dual subtitles, the transcript, and Guess mode are free. A free account is only needed if you want your saved words synced across devices.' },
  { q: 'Which languages does it support?', a: "Any pair the video has captions for. On YouTube, if one of your two languages is missing, Lingogram fills it with YouTube's automatic translation so you still get the dual view. On Netflix and HDrezka it shows the subtitle tracks the title actually has — no machine translation." },
  { q: 'Which edition do I install?', a: 'The one for the site you watch on. There are two extensions: one covers YouTube and Netflix together, the other covers HDrezka. Install both if you watch on both — they share the same learning tools and the same account, so your saved words stay in one place.' },
  { q: 'Where do my saved words live?', a: "In your personal dictionary, right here on lingogram.ai. Log in and every word you've saved is there with the scene it came from — whichever edition or device you saved it on." },
];

// The cards are install links: they go straight to the Chrome Web Store, not
// to the /<slug>/ landing pages. Netflix and YouTube share one listing (the
// YouTube extension matches netflix.com too), so both cards resolve to the
// same URL — which is correct, not a bug: either card installs what its site
// needs.
const editionCards = () => EDITIONS.editions.map((ed) => `
  <a class="ed" href="${href(ed.storeUrl)}"${ed.storeUrl ? ' rel="noopener"' : ''}>
    ${mark(ed.mark)}
    <span class="ed-t"><b>${esc(ed.name)}</b><span>${esc(ed.card)}</span><span class="go">Add to Chrome →</span></span>
  </a>`).join('') + `
  <a class="ed ed-soon" href="mailto:${SITE.supportEmail}?subject=${encodeURIComponent('Site suggestion for Lingogram')}">
    <span class="mark" aria-hidden="true">＋</span>
    <span class="ed-t"><b>Your site next</b><span>New dedicated editions ship regularly — tell us where you watch.</span><span class="go">Suggest a site →</span></span>
  </a>`;

const homePage = () => layout({
  title: SITE.title,
  description: SITE.description,
  pathName: '/',
  body: `
<div class="wrap-outer">
${header()}
<main>
  <div class="wrap">
    <section class="hero" style="padding-top:32px">
      <span class="eyebrow">Free · YouTube · Netflix · HDrezka</span>
      <h1>You've watched with subtitles before.<br><span class="pop">This time you'll get more out of it.</span></h1>
      <!-- No feature list here: the demo below shows the product, and the
           feature cards under it (Watch. Catch. Keep.) both claim AND prove
           the same three points — a text-only copy above would just duplicate
           them at their weakest. -->
      <div class="cta-row">
        <a class="btn btn-primary" href="${href(EDITIONS.primary.storeUrl)}">${CHROME_ICON}Add to Chrome — it's free</a>
        <a class="btn btn-ghost" href="#platforms">Pick the edition for your site ↓</a>
      </div>
      ${proof()}
      ${demo(EDITIONS.primary.demoUrl)}
    </section>

    <section id="platforms">
      <span class="kicker">Editions</span>
      <h2>One Lingogram, tuned for the site you watch on</h2>
      <p class="lede">Each edition is built for its site's player — native subtitle tracks, fullscreen overlay, the fixes that site needs. They share the same learning tools and the same account, so your saved words are in one place whichever you use. Two extensions cover all three sites: the YouTube one handles Netflix as well.</p>
      <div class="editions">${editionCards()}</div>
    </section>

    <section id="how">
      <span class="kicker">How it works</span>
      <h2>From install to first saved word in one video</h2>
      <div class="steps">
        <div class="step"><span class="step-n">1</span><b>Install and pick your languages</b><p>Choose the language you're learning and your own. A quick one-time setup — no account needed.</p></div>
        <div class="step"><span class="step-n">2</span><b>Open any video with captions</b><p>Press play — both languages appear together, on the video and in a transcript that scrolls with the scene.</p></div>
        <div class="step"><span class="step-n">3</span><b>Save words, review them here</b><p>Keep a word in one tap while you watch — then open your dictionary on lingogram.ai and review it with the scene it came from.</p></div>
      </div>
    </section>
  </div>

  <div class="band" id="dictionary">
    <div class="wrap">
      <span class="kicker">Your dictionary</span>
      <h2>Every word you save builds a dictionary that's actually yours</h2>
      <p class="lede">Not a frequency list from a textbook — words you met in scenes you chose, kept with the lines they came from. Whatever edition you watch with, everything lands in one account, and it's waiting for you here after you log in.</p>
      <div class="dict">
        <div class="dict-head"><b>My words</b><span class="dict-count">247 saved · 12 this week</span></div>
        <div class="dict-card">
          <div class="dict-w"><b>reluctantly</b><span class="dict-tr">неохотно</span><span class="dict-src">${mark('yt', true)}YouTube</span></div>
          <p class="dict-ctx">“He <mark>reluctantly</mark> agreed to drive the getaway car.”</p>
        </div>
        <div class="dict-card">
          <div class="dict-w"><b>getaway</b><span class="dict-tr">побег</span><span class="dict-src">${mark('nf', true)}Netflix</span></div>
          <p class="dict-ctx">“This isn't a heist, it's a <mark>getaway</mark>.”</p>
        </div>
        <div class="dict-card">
          <div class="dict-w"><b>spinning its wheels</b><span class="dict-tr">буксует</span><span class="dict-src">${mark('hd', true)}HDrezka</span></div>
          <p class="dict-ctx">“It's <mark>spinning its wheels</mark> in sixth gear!”</p>
        </div>
        <div class="dict-foot">Your words sync across devices and every Lingogram edition — <b>one account, one dictionary</b>.</div>
      </div>
    </div>
  </div>

  <div class="wrap">
    <section id="features" style="padding-top:0; margin-top:76px">
      <span class="kicker">Why it sticks</span>
      <h2>Most tools stop at translation. Lingogram makes words stick.</h2>
      <p class="lede">Lingogram is built around active recall: you don't just read along — you guess, replay, and collect, so the hours you already spend watching turn into real progress.</p>
      <div class="features">
        <div class="feat"><span class="tag">Dual subtitles</span><h3>Two languages, one screen</h3><p>Catch every line in the original and match it to your own language without pausing. When you're ready, hide the translation — dual subtitles are training wheels, and Lingogram helps you take them off.</p></div>
        <div class="feat"><span class="tag">Interactive transcript</span><h3>Replay the line, not the movie</h3><p>The transcript scrolls with the video on its own. Click any line to jump back and loop that one scene until the sounds you couldn't parse become words you instantly recognize.</p></div>
        <div class="feat"><span class="tag">Guess mode</span><h3>Listen first, then check</h3><p>Words start hidden: catch the line by ear, then reveal it. This listen-first loop builds listening you can rely on — not subtitles you only read along to. Toggle it with <kbd>Shift + G</kbd>.</p></div>
        <div class="feat"><span class="tag">Saved words</span><h3>Your vocabulary, from your movies</h3><p>One tap saves a word with the subtitle lines around it. It goes straight to <a href="#dictionary">your personal dictionary</a> on lingogram.ai, where you review every word in its original scene.</p></div>
      </div>
    </section>

    <section id="privacy">
      <span class="kicker">Private by default</span>
      <h2>What you watch stays your business</h2>
      <div class="privacy">
        <div class="cell"><span><b>No telemetry, no tracking.</b> Language and layout settings are stored locally in your browser.</span></div>
        <div class="cell"><span><b>We never see your watch history.</b> Subtitles are processed right on your device.</span></div>
        <div class="cell"><span><b>Your dictionary is opt-in.</b> If you sign in, we store your email and your saved words — nothing else, and we never sell them.</span></div>
        <div class="cell"><span><b>Built to keep working.</b> If a site update breaks something, one click reports it so we can fix it fast.</span></div>
      </div>
    </section>

    <section id="faq">
      <span class="kicker">FAQ</span>
      <h2>Questions people ask before installing</h2>
      ${qa(GLOBAL_FAQ)}
    </section>

    <section class="final">
      <span class="logo-mark">${CHAMELEON(40)}</span>
      <h2>Turn tonight's episode into your language lesson</h2>
      <div class="cta-row" style="margin-top:22px">
        <a class="btn btn-primary" href="${href(EDITIONS.primary.storeUrl)}">${CHROME_ICON}Add Lingogram to Chrome</a>
      </div>
      <p class="proof">Free · Sets up in under a minute</p>
    </section>
  </div>
</main>
${footer()}
</div>`,
});

const editionPage = (ed) => layout({
  title: `${ed.name} — dual subtitles on ${ed.site}`,
  description: ed.sub,
  pathName: `/${ed.slug}/`,
  body: `
${header()}
<main>
  <div class="wrap">
    <section class="hero" style="padding-top:32px">
      <span class="eyebrow">Lingogram for ${esc(ed.site)}</span>
      <h1>${esc(ed.heroLead)}<br><span class="pop">${esc(ed.heroPop)}</span></h1>
      <p class="sub">${esc(ed.sub)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${href(ed.storeUrl)}">${CHROME_ICON}Add to Chrome — it's free</a>
        <a class="btn btn-ghost" href="/#platforms">See all editions</a>
      </div>
      ${proof()}
      ${demo(ed.demoUrl)}
    </section>

    <section>
      <span class="kicker">Built for ${esc(ed.site)}</span>
      <h2>What the ${esc(ed.site)} edition does</h2>
      <div class="steps">
        ${ed.points.map((p, i) => `
        <div class="step"><span class="step-n">${i + 1}</span><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}
      </div>
    </section>

    <section id="faq">
      <span class="kicker">FAQ</span>
      <h2>Before you install</h2>
      ${qa([...ed.faq, ...GLOBAL_FAQ.filter((f) => f.q !== 'Which languages does it support?')])}
    </section>

    <section class="final">
      <span class="logo-mark">${CHAMELEON(40)}</span>
      <h2>Watch ${esc(ed.site)} tonight — in two languages</h2>
      <div class="cta-row" style="margin-top:22px">
        <a class="btn btn-primary" href="${href(ed.storeUrl)}">${CHROME_ICON}Add ${esc(ed.name)}</a>
      </div>
      <p class="proof">Free · Sets up in under a minute</p>
    </section>
  </div>
</main>
${footer()}`,
});

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

const privacyPage = () => {
  const source = path.join(HERE, '..', 'youtube', 'PRIVACY_POLICY.md');
  const text = fs.readFileSync(source, 'utf8');
  return layout({
    title: 'Privacy policy — Lingogram',
    description: 'What Lingogram collects, how it is used, and the choices you have.',
    pathName: '/privacy/',
    body: `${header()}<main><article class="doc">${md(text)}</article></main>${footer()}`,
  });
};

const editionsMap = JSON.stringify(
  Object.fromEntries(EDITIONS.editions.map((e) => [e.slug, e.name])),
);

const welcomePage = () => layout({
  title: 'Welcome to Lingogram',
  description: 'You are set up — here is your first saved word in three steps.',
  pathName: '/welcome/',
  body: `
${header()}
<main class="narrow">
  <span class="logo-mark" style="width:64px;height:64px;border-radius:18px;margin:20px auto">${CHAMELEON(40)}</span>
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em"><span data-ext-name>Lingogram</span> is installed</h1>
  <p class="sub">Three steps to your first saved word — it takes one video.</p>
  <div class="steps">
    <div class="step"><span class="step-n">1</span><b>Pick your languages</b><p>Click the Lingogram icon in the toolbar and choose the language you're learning and your own.</p></div>
    <div class="step"><span class="step-n">2</span><b>Open a video with captions</b><p>Press play — both languages appear together, on the video and in the transcript.</p></div>
    <div class="step"><span class="step-n">3</span><b>Save your first word</b><p>Highlight a word in the subtitles and tap to keep it — it lands in <a href="${SITE.appUrl}">your dictionary</a>.</p></div>
  </div>
  <div class="keys">
    <span><kbd>Shift + D</kbd> dual subtitles</span>
    <span><kbd>Shift + S</kbd> swap languages</span>
    <span><kbd>Shift + G</kbd> guess mode</span>
    <span><kbd>Shift + O</kbd> overlay mode</span>
  </div>
</main>
${footer()}
<script>window.__EDITIONS = ${editionsMap};</script>`,
});

const uninstallPage = () => layout({
  title: 'Sorry to see you go — Lingogram',
  description: 'Tell us why you removed Lingogram so we can fix it.',
  pathName: '/uninstall/',
  body: `
${header()}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">Sorry to see you go</h1>
  <p class="sub">One sentence about why you removed <span data-ext-name>Lingogram</span> helps us fix it for everyone.</p>
  <form id="feedback-form" data-mailto="${SITE.supportEmail}">
    <textarea id="feedback-text" placeholder="It broke on… / I expected… / I found a better…" aria-label="Why did you uninstall?"></textarea>
    <div class="cta-row" style="margin-top:16px">
      <button class="btn btn-primary" type="submit">Send feedback</button>
    </div>
  </form>
  <p class="sub" style="margin-top:34px;font-size:15px">Your saved words are still in <a href="${SITE.appUrl}">your dictionary</a> — they'll be waiting if you come back. <a href="/#platforms">Reinstall anytime.</a></p>
</main>
${footer()}
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
${header(here)}
<main class="auth-wrap">
  <div class="auth-card">
    <span class="logo-mark auth-logo">${CHAMELEON(40)}</span>
    <span class="auth-eyebrow">${eyebrow}</span>
    ${inner}
  </div>
</main>
${footer()}`;

const registerPage = () => layout({
  title: 'Create your account — Lingogram',
  description: 'Sign up to sync your saved words across every device and edition.',
  pathName: '/register/',
  scripts: authScripts,
  body: authShell('Free account', `
    <h1 class="auth-title">Start your <span class="pop">word list</span></h1>
    <p class="auth-sub">Save words from anything you watch — synced across every device and edition.</p>
    <form id="register-form" class="auth-form" novalidate>
      ${googleAuth('Sign up with Google')}
      ${field('name', 'Your name <span class="auth-optional">optional</span>', 'type="text" autocomplete="name" placeholder="Jane"')}
      ${field('email', 'Email', 'type="email" autocomplete="email" inputmode="email" placeholder="jane@example.com" required')}
      ${passwordField('Password', 'autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required', true)}
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="Creating account…">Create account</button>
    </form>
    <p class="auth-alt">Already have an account? <a href="/login/">Log in</a></p>
    <p class="auth-fine">By continuing you agree to our <a href="/privacy/">Privacy policy</a>.</p>`, 'register'),
});

const loginPage = () => layout({
  title: 'Log in — Lingogram',
  description: 'Log in to your Lingogram dictionary.',
  pathName: '/login/',
  scripts: authScripts,
  body: authShell('Welcome back', `
    <h1 class="auth-title">Your <span class="pop">dictionary</span> awaits</h1>
    <p class="auth-sub">Log in to pick up right where you left off.</p>
    <form id="login-form" class="auth-form" novalidate>
      ${googleAuth('Log in with Google')}
      ${field('email', 'Email', 'type="email" autocomplete="email" inputmode="email" placeholder="jane@example.com" required')}
      ${passwordField('Password', 'autocomplete="current-password" placeholder="Your password" required', false)}
      <div class="auth-row-end">
        <a href="#" id="reset-link" class="auth-link">Forgot password?</a>
      </div>
      <p class="auth-error" data-auth-error role="alert" aria-live="polite"></p>
      <p class="auth-note" id="reset-note">Check your inbox — a password reset link is on its way.</p>
      <button class="btn btn-primary auth-submit" type="submit" data-busy-text="Logging in…">Log in</button>
    </form>
    <p class="auth-alt">New to Lingogram? <a href="/register/">Create an account</a></p>`, 'login'),
});

const notFoundPage = () => layout({
  title: 'Page not found — Lingogram',
  description: 'This page does not exist.',
  pathName: '/404.html',
  body: `
${header()}
<main class="narrow">
  <h1 style="font-size:clamp(30px,5vw,44px);letter-spacing:-0.03em">Nothing to watch here</h1>
  <p class="sub">This page doesn't exist. The films, however, do.</p>
  <div class="cta-row"><a class="btn btn-primary" href="/">Back to Lingogram</a></div>
</main>
${footer()}`,
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

  write('index.html', homePage());
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
