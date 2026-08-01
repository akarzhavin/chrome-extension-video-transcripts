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

/**
 * The visitor's own language, if the video has a track for it. A demo that
 * always paired English with Russian would undersell the product to everyone
 * else, so the second track is theirs: `navigator.languages` in order, first
 * hit wins. Falls back to Russian, then to whatever comes after English.
 */
const nativeTrack = (): (typeof demoSubs.tracks)[number] | undefined => {
  const has = (code: string) => demoSubs.tracks.find((t) => t.lang === code && t.lang !== 'en');
  for (const tag of navigator.languages ?? [navigator.language]) {
    const hit = has((tag || '').split('-')[0].toLowerCase());
    if (hit) return hit;
  }
  return has('ru') ?? demoSubs.tracks.find((t) => t.lang !== 'en');
};

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

function wireModeSlider(instance: EmbedInstance): void {
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
  };
  showSlide('dual'); // the mode the demo opens in

  let idx = 0;
  const auto = window.setInterval(() => {
    idx = (idx + 1) % order.length;
    showSlide?.(order[idx]);
  }, 6500);
  stopAuto = () => {
    window.clearInterval(auto);
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
      if (id === 'dual' || id === 'guess') instance.setMode(id);
      if (id === 'single') showOnScreen(instance);
      if (id === 'save') {
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
