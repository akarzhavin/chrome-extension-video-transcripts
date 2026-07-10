# Promo screenshots (Chrome Web Store) — HDrezka

Polished **marketing slides** (1280×800) for the Lingogram HDrezka extension —
headline copy + the product UI on a styled backdrop. Mirrors the sibling
[`../../youtube/promo/`](../../youtube/promo/) tooling and reuses its brand layer
(`promo.css`, `tiles.css`, mascot, icon).

## Slides

| File | Layout | Copy (en) | Imagery |
| --- | --- | --- | --- |
| `slide1.html` | full window (frameless, tilted) | *learn a language while you actually enjoy films* | `host-hero` (real HDrezka player + panel) |
| `slide2.html` | side + panel crop | *every line, in both languages* | sidebar panel detail |
| `slide3.html` | side + panel crop | *pick your languages and go* | onboarding panel detail |
| `slide4.html` | side + video card | *subtitles on the video too* | real HDrezka player crop (on-video dual overlay) |
| `slide5.html` | side + panel crop | *listening mode that actually sticks* | listening-mode (guess) panel detail |

> **Style:** same "zoomer" treatment as the YouTube promo — lowercase punchy
> headlines, dark violet→emerald mesh + film grain, frameless tilted hero on
> slide 1. The static `slideN.html` carry the English copy; localized casual copy
> lives in `promo-copy.json`. Rezka ships **en / ru / uk** only.

## Where the imagery comes from

The product shots in [`../screenshots/out-live/`](../screenshots/out-live/) come
from two sources:

1. **Sidebar panel** (slides 2 / 3 / 5) — `live-demo-<loc>.png`,
   `live-demo-onboarding-<loc>.png`, `live-demo-guess-<loc>.png`. The panel is
   the **shared `SidebarUI` component** (`@video-transcripts/shared`), rendered
   **byte-identically** by the YouTube and HDrezka extensions — so these are the
   YouTube extension's demo-mode captures, reused here. They already exist
   localized for **en / ru / uk**, which is exactly Rezka's locale set.

2. **HDrezka host shots** (slides 1 / 4) — `host-hero.png` (full player + panel,
   the colourful track scene) and `host-overlay.png` (a darker scene with the
   on-video dual-subtitle overlay clearly visible). These are **real HDrezka
   captures** (originally `apps/rezka/docs/assets/screenshot2.png` /
   `screenshot1.png`), shared across all locales.

### Refreshing the HDrezka host shots

> ⚠️ **HDrezka is region/IP-blocked, not unreachable.** `rezka.ag` / `hdrezka.ag`
> serve a **"Ошибка доступа (105)"** 403 page to requests from blocked regions and
> datacenter IPs. From a browser on an **allowed-region connection / VPN** the
> site loads normally and the player **does** stream (the `<video>` lives in the
> **top document** — not a cross-origin iframe — and plays under Chrome for
> Testing). So an automated `--load-extension` + headless capture IS technically
> possible from an allowed region; the only wrinkle is the free-tier "Перейти на
> Premium" / pre-roll gate, which you must seek past for a clean frame.
>
> In practice the host shots here were **hand-captured**: open a movie on HDrezka
> (allowed-region browser), enable the extension's dual subtitles + overlay, and
> screenshot the player.

To refresh them by hand:

1. Install the built extension (`apps/rezka/build`) unpacked, on a browser that
   can reach HDrezka.
2. Open a movie/episode that has subtitle tracks in two languages, switch its
   subtitles on, and toggle the on-screen overlay (Shift + O) so the dual lines
   sit over the player.
3. Capture two frames: one showing the **whole window** (player + sidebar) → save
   as `../screenshots/out-live/host-hero.png`; one with the **on-video dual
   overlay** clearly visible (player chrome hidden) → save as `host-overlay.png`.
   The current `host-overlay.png` is exactly this: the real Lingogram overlay
   (white main line + gold translation) over a live HDrezka frame.
4. Re-run the renders below. The slide-4 `.shot` uses `background-size: cover` so
   a clean ~16:9/16:10 video frame fills the card without manual crop offsets; if
   you swap in a full-page capture instead, switch back to the panel-style
   `left`/`top` crop. For per-locale host shots later, name them
   `host-overlay-<loc>.png` and extend `shotsFor()` in `render-i18n.mjs` to prefer
   them (it currently uses one host shot for all locales).

If you only need to re-tune the **slide-4 crop** after swapping `host-overlay`,
adjust the inline `left` / `top` on the `.shot` in `slide4.html` and the matching
`slide4` template in `render-i18n.mjs`.

## Render

```bash
# English design reference → out/promo-<n>.png (1280×800) + @2x
node apps/rezka/promo/render.mjs

# All locales (en, ru, uk) → out/<locale>/screenshot-<n>.png (CWS upload set)
node apps/rezka/promo/render-i18n.mjs            # all locales in promo-copy.json
node apps/rezka/promo/render-i18n.mjs ru uk      # only the given locales
```

Screenshots each slide at deviceScaleFactor 2 (2560×1600) via Playwright's
bundled Chromium, then downscales to 1280×800 with `sips` (alpha stripped, opaque
24-bit RGB). Playwright isn't a dep of this repo; the scripts fall back to the
copy installed in the sibling "Disable automatic tab discarding" project.

## Promo tiles

```bash
node apps/rezka/promo/render-tiles.mjs
```

- `out/tile-small.png` — **440×280** (Small promo tile)
- `out/tile-marquee.png` — **1400×560** (Marquee promo tile)

Defined by `tile-small.html` / `tile-marquee.html` + `tiles.css`. Rendered at 2×,
downscaled, and the alpha channel stripped with PIL → opaque 24-bit PNG. The
marquee reuses the `live-demo-en.png` sidebar panel on the right.

## CWS asset checklist
- Screenshots: `out/<loc>/screenshot-1…5.png` — 1280×800, 24-bit PNG, no alpha (≤ 5 ✓).
- Small promo tile: `out/tile-small.png` — 440×280, no alpha.
- Marquee promo tile: `out/tile-marquee.png` — 1400×560, no alpha.

## Uploading

CWS allows max **5** screenshots per locale, set by hand in the Developer
Dashboard. Upload `out/<loc>/screenshot-1…5.png` under each of en / ru / uk.
