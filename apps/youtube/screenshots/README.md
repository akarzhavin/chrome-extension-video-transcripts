# Localized Chrome Web Store screenshots

Tooling to produce **localized store screenshots** (1280×800, JPEG, no alpha —
the CWS spec) of the YouTube extension's UI in every supported language.

Two methods are provided:

| Method | Script | Backdrop | Reliability | Use when |
| --- | --- | --- | --- | --- |
| **Live** (recommended) | `capture-live.mjs` + `run-all.sh` | real youtube.com page | depends on live YouTube | you want authentic product screenshots |
| **Mock** (fallback) | `capture.mjs` + `harness.html` | brand-neutral composite | 100% deterministic | YouTube blocks automation, or you need pixel-stable output |

Both render the **real localized strings** from `apps/youtube/_locales/<lang>/messages.json`
and the **real CSS** from `src/content/index.ts`.

---

## Demo mode (recommended for promo screenshots) — `capture-demo.mjs`

The live method depends on YouTube actually serving captions, and the
`/api/timedtext` endpoint **rate-limits (HTTP 429)** automated/signed-out
sessions after a few runs — so repeated captures start coming back blank
("No subtitles available") even though the extension works fine in a normal
browser.

To sidestep that entirely, the extension has a **promo demo mode**: load any
watch page with `#vtt-demo` in the URL and the sidebar fills with canned dual
subtitles (no network → can't be throttled) and **spotlights** the panel — the
rest of the page is dimmed + blurred so the panel pops. It's gated on the
literal `vtt-demo` token, so it never triggers for real users. Source:
`startDemoMode()` / `injectPromoStyles()` in `src/content/index.ts`.

Three variants: `#vtt-demo` (dual subtitles, a language-pair chip, a `✓ saved`
word and "142 words saved" badge), `#vtt-demo-onboarding` (the spotlit language
picker) and `#vtt-demo-guess` (guess/active-recall mode with masked words). All
skip pre-roll ads before shooting.

```bash
npm run build --workspace=@video-transcripts/youtube   # rebuild so the tokens are in build/
node apps/youtube/screenshots/capture-demo.mjs --video kJQP7kiw5Fk --mode sidebar
node apps/youtube/screenshots/capture-demo.mjs --video kJQP7kiw5Fk --mode onboarding
node apps/youtube/screenshots/capture-demo.mjs --video kJQP7kiw5Fk --mode guess
```

Drives Playwright's bundled **Chrome for Testing** (which still honours
`--load-extension`, unlike system Chrome ≥138) over a colourful video, plays it
muted for a live frame, and writes `out-live/live-demo-en.png` /
`live-demo-onboarding-en.png`. These are captured at **deviceScaleFactor 2
(2560×1600) PNG** so the promo slides stay crisp when they scale/crop the
capture — a 1× JPEG looks blurry once upscaled. The slides in
[`../promo/`](../promo/) consume those files.

---

## Prerequisites

```bash
# from repo root
npm run build --workspace=@video-transcripts/youtube   # produces apps/youtube/build
npm install --no-save puppeteer-core                   # drives Chrome over CDP (no Chromium download)
```

Needs Google Chrome installed (uses the system binary) and macOS `sips` (built in,
only for the verify step). `puppeteer-core` is installed `--no-save` on purpose —
this is local tooling, not a project dependency.

---

## Key gotchas (why it works the way it does)

These were the non-obvious blockers — keep them in mind before "simplifying" the scripts:

1. **Chrome 138+ ignores `--load-extension`.** You cannot load an unpacked
   extension from the command line anymore. → The extension must be installed
   **by hand, once**, into a persistent `--user-data-dir`, then Chrome is driven
   over the remote-debugging port (CDP). The profile keeps the install (and any
   login) across relaunches.

2. **On macOS, `--lang` does NOT change the extension UI language.** Chrome takes
   its app locale from the OS, not `--lang`. The only thing that works is the
   Cocoa argument **`-AppleLanguages '(de)'`** passed at launch — per-launch,
   does not touch the system or the profile. `chrome.i18n.getUILanguage()` then
   returns the forced locale and `_locales` resolves accordingly.

3. **MV3 service workers are lazy** — there's often no `chrome-extension://`
   target to grab. To read/write `chrome.storage.local` (to seed the language
   pair or clear it for the onboarding gate), open the extension's **popup page**
   (`chrome-extension://<id>/popup.html`) — an extension page has full `chrome.*`
   access via `page.evaluate`.

4. **The "No subtitles" scene is made deterministic** by enabling request
   interception and aborting `*/api/timedtext*`: the extension still detects the
   caption tracks but can't fetch them, so after its grace period it shows the
   real localized "No subtitles / Search again" banner — on any captioned video.

5. **Scene ↔ langPrefs:** `onboarding` requires **no** `lang.v1` in storage
   (first-run gate); `sidebar` and `nosubs` require it **set**.

---

## Live method — step by step

1. **Launch Chrome** with a persistent profile + remote debugging (replace
   `(de)` with the target locale; the first time, use any locale to install):

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222 --user-data-dir=/tmp/yt-shots-profile \
     --no-first-run --no-default-browser-check --window-size=1300,900 \
     -AppleLanguages '(en)' "chrome://extensions/"
   ```

2. **Install the extension once** (only needed the first time): in that window →
   enable *Developer mode* → *Load unpacked* → select
   `apps/youtube/build`. The install persists in the profile.

3. **Capture.** `run-all.sh` relaunches the profile once per locale with the
   right `-AppleLanguages` and drives `capture-live.mjs` over CDP:

   ```bash
   # langs (comma list of _locales names)   scenes
   apps/youtube/screenshots/run-all.sh "en,es,pt_BR,de,fr,it,ja,ko,ru,ar" "onboarding,sidebar,nosubs"

   # other video / single locale:
   VIDEO=<id> apps/youtube/screenshots/run-all.sh "de,fr" "onboarding"
   ```

   Single shot (against an already-running Chrome on :9222):
   ```bash
   node apps/youtube/screenshots/capture-live.mjs --scene sidebar --lang de --learn en --native de --video dQw4w9WgXcQ
   ```

Output → `apps/youtube/screenshots/out-live/live-<scene>-<lang>-1280x800.jpg`.

### Scenes
- `onboarding` — language picker (the most localized screen).
- `sidebar` — hero: dual subtitles on the video + in the panel. `run-all.sh`
  pairs `native` = the locale's language, `learning` = English (English locale
  flips to learning Spanish so both tracks have text).
- `nosubs` — localized "No subtitles available / Search again" banner.

### Caveats
- A YouTube **pre-roll ad** occasionally lands in the video area (live artifact);
  the sidebar — the localized part — is always clean. Re-run that locale to retry.
- The sidebar **header "Subtitles"** and "Sign in to save words" are **not**
  localized (they weren't part of the `_locales` scope — only onboarding +
  status banners were). Localize them in `_locales` + the SidebarUI source if you
  want those translated too.

---

## Mock method (deterministic fallback)

```bash
node apps/youtube/screenshots/capture.mjs --langs all --scenes onboarding,nosubs
# or a subset / with pre-selected picker values:
node apps/youtube/screenshots/capture.mjs --langs es,fr --picks learning=en,native=es
```

Output → `apps/youtube/screenshots/out/youtube-<scene>-<lang>-1280x800.jpg`.
No Chrome profile / login / network needed; renders the real CSS + localized
strings on a brand-neutral backdrop. Edit `harness.html` to change the backdrop,
brand name, or add a marketing caption.

---

## Verify (CWS spec: 1280×800, JPEG, no alpha)

```bash
for f in out-live/*.jpg; do sips -g pixelWidth -g pixelHeight -g format -g hasAlpha "$f"; done
```

## Uploading
CWS screenshots are **per-locale, set by hand** in the Developer Dashboard
(store-listing language dropdown) — they are *not* auto-localized from `_locales`
(those only feed the manifest name + short description). Max **5** per locale;
locales without their own screenshots fall back to the default listing.
