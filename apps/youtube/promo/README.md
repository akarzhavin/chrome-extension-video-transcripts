# Promo assets (Chrome Web Store)

Polished **marketing slides** (1280×800) and store tiles for the Lingogram
YouTube extension — headline copy + the product UI on a styled backdrop. This is
the layer *above* [`../screenshots/`](../screenshots/), which produces the raw
product captures; these slides reuse those captures as hero imagery.

## Layout

Each pipeline is a **self-contained, versioned recipe** for one promo
generation: `pipelines/<name>@<major>/`. It carries its own runtime, CSS, copy
and manifest, so it can be read, run and reasoned about without looking
anywhere else — and so editing one can never change what another renders.

| Pipeline | Run | Source of truth | Writes |
| --- | --- | --- | --- |
| **store-en@5** | `node pipelines/store-en@5/render.mjs` | `slide1..5.html` (English copy inline) | `out/store-en@5/promo-<n>.png` + `@2x` |
| **store-i18n@5** | `node pipelines/store-i18n@5/render.mjs [locale...]` | `assets/promo-copy.json` (54 locales) | `out/store-i18n@5/<locale>/screenshot-<n>.png` |
| **tiles@2** | `node pipelines/tiles@2/render.mjs` | `tile-marquee.html` + `assets/tiles.css` | `out/tiles@2/tile-*.png` |
| **experiments@1** | `node pipelines/experiments@1/render-ru-variants.mjs` | palette variations | `out/experiments@1/` — **never uploaded** |
| **fullscreen@1** | `node pipelines/fullscreen@1/render.mjs [--backdrop <img>]` | `slide.html` + `assets/panel.css` (panel **rebuilt**, not captured) | `out/fullscreen@1/fullscreen.png` + `@2x` |

Every pipeline answers `--help`, and `node pipelines/index.mjs` lists them all
with their versions and outputs.

### What's inside one

```
pipelines/store-en@5/
├── manifest.json     name, version, style, inputs, outputs, known issues
├── render.mjs        the entry point
├── lib.mjs           its runtime: Playwright bootstrap, paths, capture check
├── assets/           vendored — promo.css, brand-tile.png
└── slide1..5.html    the slides
```

`manifest.json` is the contract: what the pipeline reads, what it writes, and
what is known to be broken about it. `lib.mjs` derives every output path from
`manifest.name@major`, so a pipeline writes **only** under its own id and two
versions can run side by side without touching each other's files.

The duplication between pipelines is deliberate. A pipeline is a frozen recipe
for a generation that shipped; a shared helper would let a change made for a
newer generation silently alter how an older one renders.

### The pipeline that captures nothing

`fullscreen@1` is the exception to everything above: it reads **no** product
capture and **rebuilds** the panel in HTML instead.

It has to. The slide puts the product edge to edge over *arbitrary* footage,
but in fullscreen `SidebarUI` re-parents the panel **into** `#movie_player` — so
any screenshot of it arrives with that player's pixels welded behind it. Keying
the video out was tried twice and failed both times: a key layer above the video
also covers the caption overlay (both are children of the player), and one below
it stops working the moment the tab leaves fullscreen, when `position: fixed`
spans the whole viewport.

Rebuilding turns the backdrop into an input:

```bash
node pipelines/fullscreen@1/render.mjs --backdrop ~/shots/whatever.jpg
```

No browser, no login, no YouTube. The flag also copies the image over
`assets/backdrop.jpg`, so the vendored asset always matches the last render.

The cost is honesty about drift: the panel is a **replica**. Its values were
measured from the running extension over CDP (`getComputedStyle`, 2026-08-27)
rather than eyeballed, but nothing checks them afterwards — if the product's
panel changes, this slide keeps showing the old one until `assets/panel.css` is
updated by hand. That trade is recorded in its `manifest.json` under
`knownIssues`.

### The one shared input

Product captures (`apps/youtube/screenshots/out-live/`) are **not** vendored:
162 PNGs at 2560×1600, ~345 MB, used by every pipeline. Each manifest declares
the captures it needs, and `render.mjs` checks they exist *before* launching a
browser — a missing capture fails in a second with the recapture command,
instead of rendering blank frames twenty minutes in.

### Versioning

The major version is in the folder name, so an older generation stays runnable
alongside the current one. Bump it by copying the folder to a new `@N` and
editing that — never by editing a shipped pipeline in place.

`archive/` holds rendered generations that can no longer be reproduced from
source at all; see [`archive/README.md`](archive/README.md). It is the one
output folder that is **not** gitignored.

## Slides

| File | Layout | Copy | Imagery |
| --- | --- | --- | --- |
| `slide1.html` | full-bleed video frame | *Works on any video with subtitles* | none — panel **rebuilt**, vendored from `fullscreen@1` |
| `slide2.html` | full window (straight, macOS chrome) | *Turn YouTube into language practice* | `live-demo-en` (full page) |
| `slide3.html` | side + panel crop | *Every line, in both languages* | demo sidebar panel detail |
| `slide4.html` | side + panel crop | *Listen first, then check yourself* | demo guess-mode panel detail |
| `slide5.html` | side + video card | *Subtitles right on the video* | demo player-region crop (on-video overlay) |
| `slide6.html` | side + panel crop | *Set up once, then just press play* | demo onboarding panel detail |

> **Style (v3, "credible tool"):** sentence-case editorial headlines, calm
> violet→teal backdrop with a faint dot grid, ghost-chip eyebrows, glassy
> feature callouts (incl. Shift+G keycaps), and a straight-on browser window
> with macOS chrome on slide 1. Replaced the v2 "zoomer" treatment (lowercase
> hype copy, loud mesh + film grain, tilted frameless hero) after repositioning
> toward the motivated-adult-learner audience. Slide order also changed in v3:
> guess/active-recall moved up to slide 3 (it's the differentiator), onboarding
> moved to slide 5 as the zero-friction close. The static `slideN.html` carry
> the English copy; localized copy for every locale lives in `assets/promo-copy.json`
> (all locales re-localized from the v3 en block — re-localize from `en`
> whenever the English copy changes).

All product shots come from the extension's **demo mode** (spotlit panel,
canned content, no network → can't be rate-limited), captured at 2×
(2560×1600 PNG) so they stay sharp when scaled/cropped:
- `slide1`/`slide2`/`slide4` → `live-demo-en.png` (`#vtt-demo`): dual subtitles,
  an `ES ⇄ EN` chip in the header, the labelled mode row (`Dual` selected,
  `On-screen` toggled on), a `✓ saved` word, "142 words saved", and the
  on-video overlay (slide4 crops the player region).
- `slide3` → `live-demo-guess-en.png` (`#vtt-demo-guess`): guess (active-recall)
  mode with masked words.
- `slide5` → `live-demo-onboarding-en.png` (`#vtt-demo-onboarding`): the language
  picker.

Regenerate all three from one page load with
[`../screenshots/capture-backdrop.mjs`](../screenshots/capture-backdrop.mjs):

```bash
node apps/youtube/screenshots/capture-backdrop.mjs --locale en --learn es --native en \
  --modes sidebar,guess,onboarding --class vtt-light
```

Two things that quietly ruin a capture:

- **Light theme comes from the product, not the override sheet.** `--class vtt-light`
  puts the shipped `vtt-light` class on `<html>`, so the panel paints in the
  extension's own light theme. `--theme light` instead injects
  `screenshots/light-theme.capture.css`, a capture-only repaint written before the
  product had a light theme — it now drifts from what users actually see.
- **Capture from a PROD build.** `EXT_ENV=dev` (i.e. `npm run build:dev`) compiles in
  the backend switch, which paints a lime `backend: env?` bar across the top of the
  panel. Plain `npx vite build --mode background|content|page-script|popup` drops it.

The panel-crop slides scale the full capture **1.125×** and shift it left by
`1080px` so the sidebar — orig x 960→1280, exactly 320 css px — fills the 360px
frame edge to edge. Offsets are inline in the slide HTML (`.shot { left; top }`).
The scale is not cosmetic: at anything smaller the crop starts left of x=960 and
YouTube's violet page gradient bleeds down the panel's left edge.

## Render

```bash
node apps/youtube/promo/pipelines/store-en@5/render.mjs
```

Screenshots each `slideN.html` at deviceScaleFactor 2 (2560×1600) via Playwright's
bundled Chromium, then emits two PNGs per slide.

- `out/store-en@5/promo-<n>.png` — **1280×800**, the Chrome Web Store size (upload these).
- `out/store-en@5/promo-<n>@2x.png` — **2560×1600**, for the website / landing where crisp
  on hi-DPI matters (CWS rejects non-1280×800, so don't upload these to the store).
- Intermediate shots → `shots/store-en@5/` (same as the `@2x` files).
- Playwright isn't a dep of this repo; `lib.mjs` falls back to the
  copy installed in the sibling "Disable automatic tab discarding" project.

## Promo video (live screencast)

A real browser session where a synthetic cursor moves over the panel and *uses*
the tool — picks languages, watches dual subtitles light up, opens settings,
flips on Guess mode and reveals words — not a slideshow of screenshots.

```bash
node apps/youtube/promo/record-screencast.mjs
# node record-screencast.mjs --video aqz-KE-bpKQ --learn es --native en
```

- `video/out/lingogram-live-demo.mp4` — **1920×1080 (native 16:9), 30 fps, ~44 s**
  (H.264, CRF 17). Opens on the `en` store hero (`shots/store-i18n@5/en/slide1.png`) for ~1s,
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
node apps/youtube/promo/pipelines/tiles@2/render.mjs
```

- `out/tiles@2/tile-small.png` — **440×280** (Small promo tile)
- `out/tiles@2/tile-marquee.png` — **1400×560** (Marquee promo tile)

Defined by `pipelines/tiles@2/tile-small.html` / `tile-marquee.html` + `assets/tiles.css`. Rendered at 2×
then downscaled, and the alpha channel is stripped with PIL so they're **opaque
24-bit PNG** (the store rejects PNGs with alpha). The marquee reuses the
`live-demo-en.png` sidebar panel on the right.

## CWS asset checklist
- Screenshots: `out/store-en@5/promo-1…6.png` — 1280×800, 24-bit PNG, no alpha.
  **The store takes five per locale and this series now renders six.** Pick the five
  that ship before uploading; `promo-6` is the onboarding close, displaced from the
  front when the fullscreen hero took slide 1.
- Small promo tile: `out/tiles@2/tile-small.png` — 440×280, no alpha.
- Marquee promo tile: `out/tiles@2/tile-marquee.png` — 1400×560, no alpha.

## Source imagery

Captures come from `../screenshots/out-live/`. Regenerate them first (see that
folder's README) if the UI or strings change, then re-run the pipeline you need.

## Uploading

CWS allows max **5** screenshots per locale, set by hand in the Developer
Dashboard. These are English; localize by pointing the slide `.shot` images at
other `live-*-<lang>-*.jpg` captures and translating the copy.
