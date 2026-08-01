// The hero demo: the extension UI itself, via @video-transcripts/embed.
//
// Subtitles come from src/data/demo-subs.json — the video's REAL caption
// tracks, exported from the extension on youtube.com with `#vtt-export`
// (apps/youtube/src/content/subs-export.ts) and imported by
// scripts/import-demo-subs.mjs. English is the author's own track; the other
// 41 are YouTube's auto-translations of it, which is exactly what the YouTube
// edition shows a viewer whose second language has no native track.
import { mount } from '@video-transcripts/embed';
import type { EmbedInstance } from '@video-transcripts/embed';
import demoSubs from '../data/demo-subs.json';
import shotLocales from '../data/shot-locales.json';

/**
 * The page's own locale, read off the URL build.mjs generated it at:
 * unprefixed for English, `/<lang>/...` for every other site locale. A
 * visitor reading /ru/ is a Russian speaker by construction — the strongest
 * signal there is, stronger than navigator.languages, which only guesses.
 */
const pageLang = (): string => {
  const m = location.pathname.match(/^\/([a-z]{2,3})(?:\/|$)/);
  return m ? m[1] : 'en';
};

/**
 * The visitor's own language, if the video has a track for it. A demo that
 * always paired English with Russian would undersell the product to everyone
 * else, so the second track is theirs: the page's own locale first (a
 * visitor on /ru/ gets EN⇄RU without a second click), then
 * `navigator.languages` in order, first hit wins. Falls back to Russian,
 * then to whatever comes after English.
 */
const nativeTrack = (): (typeof demoSubs.tracks)[number] | undefined => {
  const has = (code: string) => demoSubs.tracks.find((t) => t.lang === code && t.lang !== 'en');
  const onPage = has(pageLang());
  if (onPage) return onPage;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const hit = has((tag || '').split('-')[0].toLowerCase());
    if (hit) return hit;
  }
  return has('ru') ?? demoSubs.tracks.find((t) => t.lang !== 'en');
};

/**
 * Phones don't get the live embed: the YouTube iframe plus the extension UI
 * is the heaviest block on the page, and a 320px sidebar can't be "tried" on
 * a 390px touch screen — the visitor is evaluating for desktop anyway. They
 * get a real, localized product still instead (scripts/prep-mobile-shots.mjs)
 * with the mode slider as the storyteller. Decided once at load; matches the
 * site's own mobile breakpoint AND the embed's internal media query.
 */
const mobile = window.matchMedia('(max-width: 760px)').matches;

/**
 * Which still to show: the visitor's language, same priority order the track
 * picker uses — but independent of it, because the fallbacks differ: an
 * English visitor's live demo pairs EN with Russian (some second track), while
 * their still is hero-en.webp, whose pair (FR ⇄ EN) is already right for them.
 */
const shotLang = (): string => {
  const onPage = pageLang();
  if ((shotLocales as string[]).includes(onPage)) return onPage;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = (tag || '').split('-')[0].toLowerCase();
    if ((shotLocales as string[]).includes(code)) return code;
  }
  return 'en';
};

/**
 * The site's translated locales — build.mjs writes one at /<lang>/ (English
 * unprefixed, at /). Kept in its own JSON rather than reusing shot-locales
 * (the demo-film rollout) because the two lists answer different questions:
 * this one is "which pages exist", that one is "which pages have their own
 * phone film" — a locale can gain page copy before its films are shot.
 */
const siteLocales = (): string[] => (shotLocales as string[]).includes('ru') ? ['en', 'ru'] : ['en'];

/**
 * The header's language switcher: a real navigation to this same page's
 * translation at /<lang>/ — not a client-side swap. It changes the page
 * language (build.mjs rendered every string), and by construction changes
 * the demo's language pair with it (nativeTrack/shotLang read the URL). Each
 * option is named in itself (Intl.DisplayNames — no shipped name table). The
 * control ships hidden; pages without the demo never populate it.
 */
const wireLangSwitch = (current: string): void => {
  const sel = document.getElementById('lang-switch') as HTMLSelectElement | null;
  if (!sel) return;
  const autonym = (code: string): string => {
    try {
      const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  };
  // The path this same page (by its trailing segment) has at another locale:
  // strip the current locale prefix, then add the target's.
  const pathFor = (lang: string): string => {
    const rest = location.pathname.replace(/^\/[a-z]{2,3}(?=\/|$)/, '') || '/';
    return lang === 'en' ? rest : `/${lang}${rest}`;
  };
  const named = siteLocales().map((code) => ({ code, name: autonym(code) }));
  named.sort((a, b) => a.name.localeCompare(b.name));
  for (const { code, name } of named) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name;
    sel.append(opt);
  }
  sel.value = current;
  // The visible pill under the transparent select (see build.mjs header).
  const wrap = sel.closest<HTMLElement>('.lang-wrap');
  const face = wrap?.querySelector('.lf-name');
  const code = wrap?.querySelector('.lf-code');
  if (face) face.textContent = autonym(current);
  if (code) code.textContent = current.toUpperCase();
  if (wrap) wrap.hidden = false;
  sel.onchange = () => {
    location.assign(pathFor(sel.value) + location.hash);
  };
};

/**
 * The per-tab films for phones (scripts/prep-mobile-shots.mjs): the card
 * above the slider plays the story of whichever tab is active. `ms` is the
 * film's full loop length — keyframe holds plus crossfades — so the
 * auto-advance and the tab's countdown line let each story finish exactly
 * once before moving on.
 */
const SHOTS: Record<string, { ms: number; alt: string }> = {
  dual: {
    ms: 4480,
    alt: 'Lingogram dual subtitles: one tap in the sidebar shows both languages in the transcript and on the video',
  },
  guess: {
    ms: 11700,
    alt: 'Guess mode: the subtitle hides behind stars and every tap on the line reveals one more word, then the translation',
  },
  single: {
    ms: 4480,
    alt: 'On-screen captions: one tap in the sidebar puts dual subtitles onto the video itself, one more clears them',
  },
  save: {
    ms: 7950,
    alt: 'Saving a word: select it right in the caption, tap the "+ Lingogram" pill and it gets its "saved" mark',
  },
};

/** Set on phones by start(); swaps the card's film when the active tab changes. */
let setShot: ((tab: string) => void) | null = null;

const start = () => {
  const container = document.getElementById('demo-embed');
  if (!container) return;

  // The sidebar treats the first track as the language being learned and the
  // second as the viewer's own; the rest stay selectable in its pickers.
  const native = nativeTrack();
  const ordered = [
    demoSubs.tracks[0],
    ...(native ? [native] : []),
    ...demoSubs.tracks.slice(1).filter((t) => t !== native),
  ];
  const tracks = ordered.map((t) => ({ name: t.name, lang: t.lang, lines: t.lines }));
  console.info('[lingogram-demo] native track:', native?.lang ?? 'none');
  // The switcher reflects the PAGE's locale, not the demo's language pair —
  // those usually agree (pageLang feeds nativeTrack), but only the page
  // locale is what the switcher actually navigates between.
  if (!mobile) wireLangSwitch(pageLang());

  // The mode-card miniatures show a sample line pair; put the translation in
  // the visitor's own language (build.mjs bakes in the Russian fallback).
  // 58.25s = "Science is a process." — short in every track.
  // Machine translation sometimes merges neighbouring sentences into one cue,
  // so keep only the first sentence and hard-cap the length — it's a caption
  // miniature, not a transcript.
  const cue = native?.lines.find((l) => Math.abs(l.startTime - 58.25) < 0.3)?.text;
  const sample = cue?.split(/(?<=[.!?…。])\s+/)[0];
  if (sample && sample.length <= 44) {
    document.querySelectorAll('[data-viz-native]').forEach((el) => (el.textContent = sample));
  }

  // Phones: a real product still inside the same demo frame, and no embed at
  // all — the check sits BEFORE mount() so the YouTube iframe, the chrome
  // shim and the extension styles are never even requested. CSS-hiding the
  // demo would have downloaded all of it anyway. The mode slider stays and
  // still switches its slides (wireModeSlider(null)); only the select-a-word
  // hint is hidden — it promises an interaction that isn't there.
  if (mobile) {
    const lang = shotLang();
    wireLangSwitch(pageLang());
    console.info('[lingogram-demo] source: per-tab films (mobile)', lang);
    // Animated WebPs filmed from THIS live demo (scripts/prep-mobile-shots
    // .mjs): the real desktop product — right-hand sidebar beside the video —
    // one film per mode-slider tab, so the tab the visitor reads about is the
    // story the card is playing. The film's video is paused throughout: the
    // backdrop is a static frame and the motion IS the functionality.
    // prefers-reduced-motion visitors get each story's payoff frame.
    const source = document.createElement('source');
    source.media = '(prefers-reduced-motion: reduce)';
    const img = document.createElement('img');
    img.className = 'demo-still';
    img.width = 1280;
    img.height = 515;
    let current = '';
    const show = (tab: string): void => {
      if (tab === current || !SHOTS[tab]) return;
      current = tab;
      // A fresh src decodes from frame zero, so every visit to a tab tells
      // its story from the start — same promise the miniatures make.
      source.srcset = `/shots/${tab}-static-${lang}.webp`;
      img.src = `/shots/${tab}-${lang}.webp`;
      img.alt = SHOTS[tab].alt;
    };
    show('dual'); // the tab the slider opens on
    const pic = document.createElement('picture');
    pic.append(source, img);
    container.replaceChildren(pic);
    setShot = show;
    // Warm the other stories while the first one plays, in slider order —
    // without this the first auto-advance swaps to a film that is still
    // downloading and the card goes blank for a beat.
    window.setTimeout(() => {
      for (const tab of Object.keys(SHOTS)) {
        if (tab !== 'dual') new Image().src = `/shots/${tab}-${lang}.webp`;
      }
    }, 2500);
    wireModeSlider(null);
    return;
  }

  // Preferred source is the real YouTube player. If embedded playback is
  // refused (bot interstitial in a fresh/incognito profile, embedding policy),
  // remount on a local copy of the same clip so every visitor sees the same
  // footage and the same lines — only the player shell differs.
  // The installed extension injects into every page, this one included, and it
  // claims the #vtt-* ids first. The embed then refuses to render (its controls
  // would drive a panel it doesn't own), so say so instead of leaving a blank
  // frame that reads as a broken demo.
  const onOwnershipConflict = () => {
    container.innerHTML = `
      <p class="demo-conflict">
        <b>You already have Lingogram installed.</b>
        The extension is running on this page, so the inline demo steps aside —
        the two share the same interface and would fight over it.
        Open any video site to use the real thing, or view this page in a
        private window to see the demo.
      </p>`;
  };

  const mountFile = () => {
    console.info('[lingogram-demo] source: local file (YouTube embed unavailable)');
    return mount({
      container,
      videoSrc: '/demo-clip.mp4',
      tracks,
      savedWordCount: 247,
      onOwnershipConflict,
      onModeChange: (m) => syncSliderToDemo(m),
    });
  };

  console.info('[lingogram-demo] source: youtube', demoSubs.youtubeVideoId);
  const instance = mount({
    container,
    youtubeVideoId: demoSubs.youtubeVideoId,
    youtubeStart: demoSubs.windowStart,
    youtubeEnd: demoSubs.windowEnd,
    tracks,
    savedWordCount: 247,
    onOwnershipConflict,
    onModeChange: (m) => syncSliderToDemo(m),
    onPlaybackFail: () => {
      instance.destroy();
      // The slider must drive whatever is mounted now, not the instance that
      // just failed.
      wireModeSlider(mountFile());
    },
  });
  wireModeSlider(instance);
};

/**
 * The mode slider under the demo, two-way coupled to it:
 *  - a slide's CTA switches the demo above;
 *  - switching modes in the demo's own panel (onModeChange) brings up the
 *    matching slide — the slider narrates whatever the visitor clicks.
 * Until either happens it auto-advances gently, so all four stories get seen
 * without a single interaction.
 */
let showSlide: ((id: string) => void) | null = null;
let stopAuto: (() => void) | null = null;

const syncSliderToDemo = (mode: string): void => {
  stopAuto?.();
  showSlide?.(mode);
};

/**
 * The On-screen slide's gesture toward the demo. NOT a mode change: forcing
 * displayMode 'single' here used to unlight both radio chips in the panel's
 * MODES bar, which read as "everything just deactivated" — while the slide's
 * own miniature shows the mode chip staying lit and only the toggle flipping.
 * So do what the miniature promises: keep the visitor's mode, make sure the
 * captions are actually on the film, and pulse them so the eye lands where
 * the story points.
 */
const showOnScreen = (instance: EmbedInstance): void => {
  instance.setOverlay(true);
  const overlay = document.getElementById('vtt-video-overlay');
  overlay?.classList.remove('os-flash');
  void (overlay as HTMLElement | null)?.offsetWidth; // restart the animation
  overlay?.classList.add('os-flash');
};

// `instance` is null on phones: no live demo to drive, so tabs only switch
// their own slides (and restart the miniatures' animations).
function wireModeSlider(instance: EmbedInstance | null): void {
  const slider = document.getElementById('mode-slider');
  if (!slider) return;
  // Remount (YouTube → file fallback) wires the slider again: kill the
  // previous auto-advance interval, or its stopAuto handle is orphaned and the
  // slider keeps flipping after the visitor has interacted.
  stopAuto?.();
  const tabs = [...slider.querySelectorAll<HTMLButtonElement>('.mtab')];
  const slides = [...slider.querySelectorAll<HTMLElement>('.mslide')];
  const order = slides.map((s) => s.dataset.slide!);

  showSlide = (id) => {
    if (!order.includes(id)) return;
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.slide === id));
    slides.forEach((s) => {
      const active = s.dataset.slide === id;
      const wasActive = s.classList.contains('is-active');
      s.classList.toggle('is-active', active);
      // The miniatures' loops run from page load, so without this a visitor
      // lands mid-story — the guess reveal half-done, the toggle mid-flip.
      // Rewind the newly shown slide's animations to beat zero: every visit
      // tells its story from the first frame.
      if (active && !wasActive) {
        for (const a of s.getAnimations({ subtree: true })) {
          a.cancel();
          a.play();
        }
      }
    });
    // On phones the card above plays the active tab's film.
    setShot?.(id);
  };
  showSlide('dual'); // the mode the demo opens in

  // The advance beat: fixed on desktop, where the slides are peers of the
  // live demo; on phones each slide owns the card's film, so the beat is that
  // film's full loop — a story always finishes exactly once before the next
  // begins, and the tab's countdown line (--tab-auto) fills over the same span.
  const delayFor = (id: string): number => (setShot ? SHOTS[id]?.ms ?? 6500 : 6500);
  let idx = 0;
  let timer = 0;
  const tick = () => {
    const ms = delayFor(order[idx]);
    slider.style.setProperty('--tab-auto', `${ms}ms`);
    timer = window.setTimeout(() => {
      idx = (idx + 1) % order.length;
      showSlide?.(order[idx]);
      tick();
    }, ms);
  };
  tick();
  stopAuto = () => {
    window.clearTimeout(timer);
    slider.classList.add('m-no-auto'); // hides the countdown line on the tab
  };

  for (const tab of tabs) {
    tab.onclick = () => {
      stopAuto?.();
      const id = tab.dataset.slide!;
      idx = order.indexOf(id);
      showSlide?.(id);
      // The tab drives the demo too: reading about a mode and watching it
      // happen must be one gesture. On-screen is the overlay's story, not a
      // mode (see showOnScreen); the dictionary tab has no mode to set — its
      // slide's CTA points at the always-on selection flow instead.
      if (instance && (id === 'dual' || id === 'guess')) instance.setMode(id);
      if (instance && id === 'single') showOnScreen(instance);
      if (instance && id === 'save') {
        // Nothing to switch — the selection flow is always live. Flash the
        // "select a word" instruction under the demo so the tab still points
        // at something the visitor can do.
        const hint = document.querySelector('.demo-hint');
        hint?.classList.remove('hint-flash');
        void (hint as HTMLElement | null)?.offsetWidth; // restart the animation
        hint?.classList.add('hint-flash');
      }
    };
  }

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
