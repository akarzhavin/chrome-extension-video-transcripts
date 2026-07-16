# Promo screenshots (Chrome Web Store)

Polished **marketing slides** (1280×800) for the Lingogram YouTube extension —
headline copy + the product UI on a styled backdrop. This is the layer *above*
[`../screenshots/`](../screenshots/), which produces the raw product captures;
these slides reuse those captures as hero imagery.

Modeled on the `promo/` tooling in the sibling "Disable automatic tab
discarding" extension.

## Slides

| File | Layout | Copy | Imagery |
| --- | --- | --- | --- |
| `slide1.html` | full window (straight, macOS chrome) | *Turn YouTube into language practice* | `live-demo-en` (full page) |
| `slide2.html` | side + panel crop | *Every line, in both languages* | demo sidebar panel detail |
| `slide3.html` | side + panel crop | *Listen first, then check yourself* | demo guess-mode panel detail |
| `slide4.html` | side + video card | *Subtitles right on the video* | demo player-region crop (on-video overlay) |
| `slide5.html` | side + panel crop | *Set up once, then just press play* | demo onboarding panel detail |

> **Style (v3, "credible tool"):** sentence-case editorial headlines, calm
> violet→teal backdrop with a faint dot grid, ghost-chip eyebrows, glassy
> feature callouts (incl. Shift+G keycaps), and a straight-on browser window
> with macOS chrome on slide 1. Replaced the v2 "zoomer" treatment (lowercase
> hype copy, loud mesh + film grain, tilted frameless hero) after repositioning
> toward the motivated-adult-learner audience. Slide order also changed in v3:
> guess/active-recall moved up to slide 3 (it's the differentiator), onboarding
> moved to slide 5 as the zero-friction close. The static `slideN.html` carry
> the English copy; localized copy for every locale lives in `promo-copy.json`
> (all locales re-localized from the v3 en block — re-localize from `en`
> whenever the English copy changes).

All product shots come from the extension's **demo mode** (spotlit panel,
canned content, no network → can't be rate-limited), captured at 2×
(2560×1600 PNG) so they stay sharp when scaled/cropped:
- `slide1`/`slide2`/`slide4` → `live-demo-en.png` (`#vtt-demo`): dual subtitles,
  a `🇪🇸 Español → 🇬🇧 English` chip, a `✓ saved` word, "142 words saved", and the
  on-video overlay (slide4 crops the player region).
- `slide3` → `live-demo-onboarding-en.png` (`#vtt-demo-onboarding`): the language
  picker.
- `slide5` → `live-demo-guess-en.png` (`#vtt-demo-guess`): guess (active-recall)
  mode with masked words.

Regenerate with [`../screenshots/capture-demo.mjs`](../screenshots/capture-demo.mjs)
(`--mode sidebar` / `--mode onboarding`).

The panel-crop slides scale the full capture ≈1.12× and shift it so only the
dark sidebar (orig x≈955→1280) fills the frame — offsets are inline in the
slide HTML (`.shot { left; top }`).

## Render

```bash
node apps/youtube/promo/render.mjs
```

Screenshots each `slideN.html` at deviceScaleFactor 2 (2560×1600) via Playwright's
bundled Chromium, then emits two PNGs per slide.

- `out/promo-<n>.png` — **1280×800**, the Chrome Web Store size (upload these).
- `out/promo-<n>@2x.png` — **2560×1600**, for the website / landing where crisp
  on hi-DPI matters (CWS rejects non-1280×800, so don't upload these to the store).
- Intermediate shots → `shots/` (same as the `@2x` files).
- Playwright isn't a dep of this repo; `render.mjs` falls back to the copy
  installed in the sibling "Disable automatic tab discarding" project.

## Promo video (live screencast)

A real browser session where a synthetic cursor moves over the panel and *uses*
the tool — picks languages, watches dual subtitles light up, opens settings,
flips on Guess mode and reveals words — not a slideshow of screenshots.

```bash
node apps/youtube/promo/record-screencast.mjs
# node record-screencast.mjs --video aqz-KE-bpKQ --learn es --native en
```

- `video/out/lingogram-live-demo.mp4` — **1920×1080 (native 16:9), 30 fps, ~44 s**
  (H.264, CRF 17). Opens on the `en` store hero (`shots/en/slide1.png`) for ~1s,
  then crossfades into the live demo. Recorded at a 1920×1080 viewport with DSF 2
  (the page renders at 2× and is supersampled down — `recordVideo` captures at the
  CSS viewport size, so the viewport must be 1080p for a crisp 1080p result).
- Backdrop is a **local Big Buck Bunny clip** (Blender's **CC-BY** open movie),
  layered as a `<video>` over the YouTube player so the render shows real,
  freely-licensed footage — no Content ID "Visual" claim like the earlier
  Despacito backdrop, no ads/playback errors, and we control the scene + framing.
  Audio is stripped (`-an`). The clip self-cuts from `video/big_buck_bunny_*.mov`
  (both gitignored; large). Served same-origin via Playwright `ctx.route` (+
  `bypassCSP`) so it isn't blocked as mixed content.
- Drives the extension's built-in `#vtt-demo` mode over the real YouTube player
  (hidden behind the backdrop); switches state through the same `__lingogram`
  postMessage hook the screenshot tool uses, so it needs no network captions.
- Playwright's `recordVideo` captures page pixels but **not** the OS pointer, so
  the script injects its own arrow + click ripples and drives them in lockstep
  with real `page.mouse` moves (real `:hover`/click handlers still fire).
- The ad-skip warm-up at the front is trimmed off in ffmpeg; a branded end card
  fades in at the close. Raw `.webm` lands in `video/out/raw/` (gitignored).

## Promo tiles

The store also wants two marketing tiles (separate from screenshots):

```bash
node apps/youtube/promo/render-tiles.mjs
```

- `out/tile-small.png` — **440×280** (Small promo tile)
- `out/tile-marquee.png` — **1400×560** (Marquee promo tile)

Defined by `tile-small.html` / `tile-marquee.html` + `tiles.css`. Rendered at 2×
then downscaled, and the alpha channel is stripped with PIL so they're **opaque
24-bit PNG** (the store rejects PNGs with alpha). The marquee reuses the
`live-demo-en.png` sidebar panel on the right.

## CWS asset checklist
- Screenshots: `promo-1…5.png` — 1280×800, 24-bit PNG, no alpha (≤ 5 ✓).
- Small promo tile: `tile-small.png` — 440×280, no alpha.
- Marquee promo tile: `tile-marquee.png` — 1400×560, no alpha.

## Source imagery

Captures come from `../screenshots/out-live/`. Regenerate them first (see that
folder's README) if the UI or strings change, then re-run `render.mjs`.

## Uploading

CWS allows max **5** screenshots per locale, set by hand in the Developer
Dashboard. These are English; localize by pointing the slide `.shot` images at
other `live-*-<lang>-*.jpg` captures and translating the copy.
