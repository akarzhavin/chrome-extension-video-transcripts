// Layout corrections for running the extension UI inside a page element.
//
// The component styles themselves come from the extension's stylesheet
// (apps/rezka/src/assets/styles.css), which the embed bundle inlines — this
// only re-anchors the pieces that are positioned against the viewport in a
// real page: the fixed sidebar, the fixed on-video overlay, and the floating
// quick-add pill / toast / auth badge.
export const EMBED_CSS = `
.lingogram-embed {
  --lge-radius: 14px;
  --lge-sidebar-w: 320px; /* #vtt-sidebar's own width in the extension */
  --lge-controls-h: 62px; /* the player bar: 48px button row + scrubber above */
  position: relative;
  display: grid;
  grid-template-columns: 1fr var(--lge-sidebar-w);
  background: #0d0b16;
  border-radius: var(--lge-radius);
  overflow: hidden;
  isolation: isolate;
  contain: layout paint;
  transition: grid-template-columns 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
/* Collapsing is a translateX in the extension, which frees viewport edge but
   not a grid column — so the column has to close with it, or the video would
   keep a dead gap where the panel was. */
.lingogram-embed.lge-collapsed { --lge-sidebar-w: 0px; }

/* The stage drives the block's height: 16:9, the shape video actually is.
   A fixed height instead would letterbox the clip into a wide strip and make
   the 320px sidebar (its real width in the extension — not a number to tune)
   read as oversized next to it, while clipping the panel's own content. */
.lingogram-embed .lge-stage { position: relative; aspect-ratio: 16 / 9; min-height: 360px; overflow: hidden; }
.lingogram-embed .lge-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
/* Native YouTube controls stay usable — the iframe takes pointer input. */
.lingogram-embed iframe.lge-yt, .lingogram-embed div.lge-yt { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; border: 0; }

/* Sidebar: fixed to the viewport edge in the extension, in-flow here. */
.lingogram-embed .lge-sidebar { position: relative; background: #161320; overscroll-behavior: contain; }
.lingogram-embed .lge-sidebar #vtt-sidebar {
  position: absolute; inset: 0;
  width: 100%; height: 100%; max-height: none;
  border-radius: 0; box-shadow: none; z-index: 1;
}
/* The transcript scrolls, so a line is always cut at the bottom edge. In the
   extension that edge is the screen's; here it lands on the block's rounded
   corner, where a hard slice reads as broken layout rather than "there's more".
   A short fade sells it as continuing content. */
.lingogram-embed .lge-sidebar::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 44px;
  background: linear-gradient(to top, #161320, rgba(22, 19, 32, 0));
  pointer-events: none; z-index: 2;
}
.lingogram-embed.lge-collapsed .lge-sidebar::after { display: none; }

/* Scrollbars inside the demo panel. The extension inherits whatever the OS
   draws — on macOS an overlay bar that pops in system-grey over the dark panel
   and vanishes between scrolls. Here the panel is a showpiece, so every
   scrollable inside it gets the same bar: slim, rounded, inset from the edge,
   and always present (styling ::-webkit-scrollbar is itself what opts out of
   the OS's auto-hiding overlay). Universal-descendant on purpose — the
   transcript, the settings page and any dropdown list all scroll. */
/* Chromium: setting the standard scrollbar-width/scrollbar-color properties
   DISABLES ::-webkit-scrollbar styling — so the standard pair is scoped to
   engines with no ::-webkit-scrollbar (Firefox), and explicitly reset to auto
   where it exists (the extension stylesheet sets thin on #vtt-list, which
   would otherwise kill the custom bar below). */
@supports selector(::-webkit-scrollbar) {
  .lingogram-embed .lge-sidebar *,
  .lingogram-embed #vtt-list {
    scrollbar-width: auto;
    scrollbar-color: auto;
  }
}
@supports not selector(::-webkit-scrollbar) {
  .lingogram-embed .lge-sidebar *,
  .lingogram-embed #vtt-list {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
  }
}
/* #vtt-list carries its own id-specificity scrollbar rules in the extension
   stylesheet (6px, dimmer), so it is named here explicitly or it would keep
   them and the two bars would not match. */
.lingogram-embed .lge-sidebar ::-webkit-scrollbar,
.lingogram-embed #vtt-list::-webkit-scrollbar { width: 10px; }
.lingogram-embed .lge-sidebar ::-webkit-scrollbar-track,
.lingogram-embed #vtt-list::-webkit-scrollbar-track { background: transparent; }
.lingogram-embed .lge-sidebar ::-webkit-scrollbar-thumb,
.lingogram-embed #vtt-list::-webkit-scrollbar-thumb {
  /* border + background-clip float the thumb off the panel edge; a bare 10px
     bar glued to the rounded corner is exactly the artefact being removed. */
  background: rgba(255, 255, 255, 0.28);
  border: 3px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
  min-height: 40px;
}
.lingogram-embed .lge-sidebar ::-webkit-scrollbar-thumb:hover,
.lingogram-embed #vtt-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.45);
  background-clip: padding-box;
}

.lingogram-embed.lge-no-tab .lge-sidebar #vtt-toggle-btn { display: none; }
/* The panel itself is clipped to its column — when it slides out, it must not
   spill over the video. The tab is the one part allowed outside, so it is
   pinned to the container (not the column) and stays reachable at any width. */
.lingogram-embed .lge-sidebar { overflow: hidden; }
/* The slot is a zero-width anchor on the panel's edge, not a box of its own:
   given a width it would push the tab a further 40px off the sidebar, leaving
   the tab floating in the middle of the video. The tab hangs to the left of
   that anchor, exactly as left:-40px does against the panel in the
   extension. */
.lingogram-embed .lge-tab-slot {
  position: absolute; top: 50%; right: var(--lge-sidebar-w); width: 0; z-index: 4;
  transform: translateY(-50%);
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.lingogram-embed .lge-tab-slot #vtt-toggle-btn {
  position: absolute; top: 50%; right: 0; left: auto;
  transform: translateY(-50%);
}
/* The extension anchors these to #vtt-sidebar (hover brighten, arrow flip);
   with the tab re-homed to the container they need container-level mirrors. */
.lingogram-embed:hover .lge-tab-slot #vtt-toggle-btn { opacity: 1; }
.lingogram-embed.lge-collapsed .lge-tab-slot #vtt-toggle-btn svg { transform: rotate(180deg); }

/* ---------- fullscreen ----------
   The stage goes fullscreen and the panel is re-parented into it, so the
   embed's grid no longer applies: the panel sizes itself against the screen
   (it is position:fixed) and the tab rides along inside the stage. Without
   this the panel keeps the .lge-sidebar column's geometry — off-screen and
   unreachable, with the tab left behind outside the fullscreen element. */
/* Stops short of the control bar rather than covering it — the same trade the
   extension makes on a real player (styles.css: height: calc(100vh - 75px)).
   Full height would bury play/scrub/fullscreen under the transcript. */
.lingogram-embed .lge-stage:fullscreen #vtt-sidebar {
  position: fixed; inset: 0 0 var(--lge-controls-h) auto;
  width: 320px; height: auto; max-height: none;
  border-bottom-left-radius: 12px;
  z-index: 2147483647;
}
/* Collapsed is a translateX in the extension; keep that, it's the same gesture
   the tab flips back. */
.lingogram-embed .lge-stage:fullscreen #vtt-sidebar.collapsed { transform: translateX(100%); }
/* The tab hangs off the panel's edge, and follows it when the panel slides
   away — in fullscreen there is no grid column to anchor to, so it is measured
   from the screen's right edge instead. */
.lingogram-embed .lge-stage:fullscreen #vtt-toggle-btn {
  /* Centred on the panel, which stops above the control bar — not on the
     screen, or it would sit half a bar lower than the thing it opens. */
  position: fixed; top: calc((100% - var(--lge-controls-h)) / 2); right: 320px; left: auto;
  transform: translateY(-50%);
  /* Glass over the picture, mirroring what the extension does for its own
     fullscreen tab — the extension's rule anchors to #vtt-sidebar, and here the
     tab has been re-parented into the stage, so it needs its own copy. */
  background-color: var(--vtt-panel);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 1; z-index: 2147483647;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
}
/* :has, not a sibling combinator — the tab is inserted before the panel. */
.lingogram-embed .lge-stage:fullscreen:has(#vtt-sidebar.collapsed) #vtt-toggle-btn { right: 0; }
.lingogram-embed .lge-stage:fullscreen:has(#vtt-sidebar.collapsed) #vtt-toggle-btn svg { transform: rotate(180deg); }
/* Captions keep clear of the open panel, matching what the extension does on a
   real player. */
.lingogram-embed .lge-stage:fullscreen #vtt-video-overlay { right: 320px; }
.lingogram-embed .lge-stage:fullscreen:has(#vtt-sidebar.collapsed) #vtt-video-overlay { right: 0; }

/* The YouTube source has no fullscreen path at all (player.ts, fs: 0 — see
   the note in embed.ts), so every :fullscreen rule above concerns only the
   file source's stage. */

/* On-video overlay: anchored to the stage, not the viewport. */
.lingogram-embed .lge-stage #vtt-video-overlay {
  position: absolute; left: 0; right: 0; z-index: 2;
  align-items: center; justify-content: center; text-align: center;
}

/* Floating extension chrome, clipped to the embed. */
.lingogram-embed #lingogram-quick-add-pill,
.lingogram-embed #lingogram-quick-add-toast { z-index: 6; }
.lingogram-embed #lingogram-auth-badge { position: absolute; z-index: 5; }

/* ---------- player chrome: a replica of YouTube's control bar ----------
   The real one is inside a cross-origin iframe, so it is rebuilt here to
   YouTube's own measurements: a 48px button row, 24px glyphs on a 36px box,
   the scrubber sitting just above it, and the same bottom-up scrim. Numbers
   below are YouTube's, not taste — changing them is what makes a replica stop
   reading as the thing it copies. */
.lingogram-embed .lge-controls {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 3;
  padding: 0 12px 0;
  background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.45) 60%, transparent);
  color: #fff;
  font: 500 13px/1 "YouTube Noto", Roboto, Arial, -apple-system, BlinkMacSystemFont, sans-serif;
  opacity: 1; transition: opacity 0.25s ease;
}
/* The bar fades with the player, the way YouTube's does. */
.lingogram-embed .lge-stage.is-idle .lge-controls { opacity: 0; }
.lingogram-embed .lge-stage.is-idle { cursor: none; }

/* Scrubber. YouTube's is a 3px line that grows to 5px while hovered/dragged,
   with the knob only appearing then. */
.lingogram-embed .lge-track { position: relative; height: 14px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.lingogram-embed .lge-track-line { position: relative; width: 100%; height: 3px; background: rgba(255,255,255,0.25); transition: height 0.1s ease; }
.lingogram-embed .lge-track:hover .lge-track-line,
.lingogram-embed .lge-scrubbing .lge-track-line { height: 5px; }
.lingogram-embed .lge-buffer { position: absolute; inset: 0 auto 0 0; width: 100%; background: rgba(255,255,255,0.35); }
.lingogram-embed .lge-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: #f00; }
.lingogram-embed .lge-knob {
  position: absolute; right: -6.5px; top: 50%; width: 13px; height: 13px;
  margin-top: -6.5px; border-radius: 50%; background: #f00;
  transform: scale(0); transition: transform 0.1s ease;
}
.lingogram-embed .lge-track:hover .lge-knob,
.lingogram-embed .lge-scrubbing .lge-knob { transform: scale(1); }

/* Button row. */
.lingogram-embed .lge-row { display: flex; align-items: center; height: 48px; }
.lingogram-embed .lge-spacer { flex: 1; }
.lingogram-embed .lge-yt-btn {
  width: 46px; height: 48px; padding: 0; border: none; background: none;
  color: #fff; cursor: pointer; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0.92; transition: opacity 0.1s ease;
}
.lingogram-embed .lge-yt-btn:hover { opacity: 1; }
.lingogram-embed .lge-yt-btn svg { width: 36px; height: 36px; display: block; }
.lingogram-embed .lge-play .lge-pause-icon,
.lingogram-embed .lge-play.paused .lge-play-icon { display: block; }
.lingogram-embed .lge-play .lge-play-icon,
.lingogram-embed .lge-play.paused .lge-pause-icon { display: none; }
/* Volume: the slider is collapsed to nothing and expands on hover/focus, the
   way YouTube's does — at rest the row stays a tidy line of glyphs. */
.lingogram-embed .lge-vol { display: inline-flex; align-items: center; height: 48px; }
.lingogram-embed .lge-vol-slider {
  width: 0; overflow: hidden; opacity: 0; cursor: pointer;
  height: 48px; display: inline-flex; align-items: center;
  transition: width 0.2s ease, opacity 0.2s ease, margin 0.2s ease;
  touch-action: none;
}
.lingogram-embed .lge-vol:hover .lge-vol-slider,
.lingogram-embed .lge-vol-slider:focus-visible {
  width: 60px; opacity: 1; margin-right: 6px;
}
.lingogram-embed .lge-vol-line {
  position: relative; width: 100%; height: 3px; border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
}
.lingogram-embed .lge-vol-fill {
  position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 2px; background: #fff;
}
/* The handle rides the filled end, like the scrubber's knob. */
.lingogram-embed .lge-vol-fill::after {
  content: ""; position: absolute; right: -5px; top: 50%; width: 11px; height: 11px;
  margin-top: -5.5px; border-radius: 50%; background: #fff;
}
.lingogram-embed .lge-mute .lge-vol-muted,
.lingogram-embed .lge-mute.is-muted .lge-vol-loud { display: none; }
.lingogram-embed .lge-mute .lge-vol-loud,
.lingogram-embed .lge-mute.is-muted .lge-vol-muted { display: block; }
@media (prefers-reduced-motion: reduce) {
  .lingogram-embed .lge-vol-slider { transition: none; }
}

.lingogram-embed .lge-time {
  font-variant-numeric: tabular-nums; font-size: 13px; color: #fff;
  padding: 0 10px 0 6px; white-space: nowrap;
}

/* Mascot + subtitle toggle as ONE unit, mirroring the YouTube edition's
   .vtt-ytp-anchor: a pill behind the pair reads as "this extension: open it /
   turn it on" rather than two unrelated glyphs sharing the row. Dark fill and a
   light hairline, not translucent white — the bar is see-through and white on
   white vanishes over a bright frame. */
.lingogram-embed .lge-anchor { position: relative; display: inline-flex; align-items: center; height: 48px; flex: none; }
.lingogram-embed .lge-anchor::before {
  content: ""; position: absolute; inset: 6px 2px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.38); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
  pointer-events: none;
}
/* 40px, the extension's own number: two of us share the space one native 48px
   control would take. Full row height keeps both on YouTube's optical centre. */
.lingogram-embed .lge-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 100%; flex: none;
  border: none; background: none; color: #fff; cursor: pointer; padding: 0;
}
/* Highlight the area, never the glyph — brightening an already-white icon just
   turns it into a solid block. */
.lingogram-embed .lge-btn::after {
  content: ""; position: absolute; inset: 7px 3px; border-radius: 999px;
  background: rgba(255,255,255,0.12); opacity: 0; transition: opacity 0.12s ease;
}
.lingogram-embed .lge-btn:hover::after { opacity: 1; }
.lingogram-embed .lge-btn > * { position: relative; z-index: 1; }
/* 22px, not the row's 17: the mascot is a filled shape with rounded edges, so
   it reads lighter than an outline glyph at matching size. */
/* 26px, not the row's 24: the mascot is a filled shape with rounded edges, so
   it reads lighter than an outline glyph at matching size (same call as the
   extension's .vtt-ytp-overlay-btn img). */
.lingogram-embed .lge-lingogram img { width: 26px; height: 26px; display: block; object-fit: contain; }
.lingogram-embed .lge-subs svg { width: 24px; height: 24px; display: block; }
/* Off = dimmed, matching the extension's greyscale/colour convention. */
.lingogram-embed .lge-subs[aria-checked="false"] { color: rgba(255,255,255,0.55); }

/* The mascot's menu. Anchored to the pill and opening upward — it hangs off a
   control that already sits at the bottom of the player. */
.lingogram-embed .lge-menu {
  position: absolute; bottom: calc(100% + 10px); right: -2px; z-index: 4;
  min-width: 210px; padding: 6px;
  background: rgba(20, 18, 28, 0.96); border-radius: 12px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 12px 32px -8px rgba(0,0,0,0.7);
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.lingogram-embed .lge-menu[hidden] { display: none; }
.lingogram-embed .lge-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; padding: 9px 11px; border: none; border-radius: 8px;
  background: none; color: #e9e6f2; font: inherit; text-align: left; cursor: pointer;
}
.lingogram-embed .lge-row:hover { background: rgba(255,255,255,0.11); }
.lingogram-embed .lge-row-value { color: #a79fd0; }
.lingogram-embed .lge-row-back { color: #a79fd0; }
/* The selected mode is marked with a tick, so the row states its own state. */
.lingogram-embed .lge-row[aria-checked="true"]::after { content: "✓"; color: #a390ff; }
.lingogram-embed .lge-cc { font-size: 11px; font-weight: 800; border-radius: 4px; padding: 2px 6px; background: #7c5cff; color: #fff; }

@media (max-width: 760px) {
  .lingogram-embed { grid-template-columns: 1fr; }
  .lingogram-embed .lge-sidebar { min-height: 300px; }
  /* One column: the width variable no longer drives layout, so collapsing
     switches to hiding the sidebar row; the tab would float mid-frame
     (right: 320px against a full-width row), so it goes away entirely. */
  .lingogram-embed .lge-tab-slot { display: none; }
  .lingogram-embed.lge-collapsed .lge-sidebar { display: none; }
}
`;
