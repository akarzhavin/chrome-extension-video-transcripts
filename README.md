<div align="center">
  <img src="assets/icon-128.png" width="128" height="128" alt="Lingogram logo" />
  <h1>Learn languages while watching Rezka & YouTube</h1>
  <p><b>Interactive transcripts, dual subtitles, and one-click word capture into your Lingogram dictionary.</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://chrome.google.com/webstore)
  [![Vite](https://img.shields.io/badge/Build-Vite-%23646CFF.svg)](https://vitejs.dev/)
  [![TypeScript](https://img.shields.io/badge/Language-TypeScript-%233178C6.svg)](https://www.typescriptlang.org/)
  [![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-lightgrey.svg)](PRIVACY_POLICY.md)
</div>

---

## 🌟 Overview

This repo ships **three Chrome extensions** that turn passive reading and watching into active language learning:

- **Rezka** — for [rezka.ag](https://rezka.ag) / HDRezka. Intercepts native `.vtt` subtitle tracks.
- **YouTube** — for [youtube.com](https://youtube.com). Captures auto-generated and uploaded captions.
- **Web** — for **any website**. Select English text anywhere, right-click → **Add to Lingogram**, and the word goes straight to your inbox. No transcript sidebar — just one-click capture via the context menu.

The two video extensions expose the same interactive transcript sidebar and dual-subtitle merging. **All three** share the same "Sign in on Lingogram" flow that lets you save unknown words to your personal dictionary on [lingogram.app](https://lingogram-app.web.app) without leaving the page.

---

## 🚀 How it Works

1. **Open any video** on a supported site and enable captions in the native player.
2. The **transcript sidebar** appears with the full text, auto-scrolling to the current phrase.
3. **Load a second language** in the player to merge tracks into **Dual Mode**.
4. **Sign in on Lingogram** (one click in the popup → tab opens, you sign in once, the tab closes itself). The extension's service worker holds the auth handoff for future word captures.
5. **Highlight any word** in the transcript → the quick-add pill writes it to your Firestore inbox.
6. Visit [/student/vocabulary](https://lingogram-app.web.app/student/vocabulary) on Lingogram → the **Rezka** collection card shows pending words and drains them into your dictionary topic with one click.

> **Web extension (any site):** skip steps 1–3 — just select text, right-click → **Add to Lingogram**. Sign-in (step 4) and the inbox drain (step 6) are identical.

---

## ✨ Key Features

### 📚 Synchronized Transcript Sidebar
The entire video text is available in an interactive sidebar. The current phrase is automatically highlighted and scrolled into view as the video plays.

<img src="apps/rezka/docs/assets/screenshot1.png" width="100%" alt="Transcript Sidebar View" />

### 🌐 Dynamic Dual Subtitles
Learn by comparing two languages side-by-side. Once you load two different tracks in the original player, the extension merges them for maximum contextual understanding.

### 🖱️ Interactive Navigation & Seeking
Click any sentence in the transcript to instantly jump to that specific moment in the video. Perfect for repeating difficult phrases or skipping ahead.

### 🎓 Smart Learning Modes
- **Dual Mode** — see both languages at once.
- **Guess Mode (Blur)** — hide the primary language and reveal it word-by-word or on hover to test your listening skills.
- Preferences persist across reloads via `chrome.storage`.

### 🌍 Capture from Any Website (Web extension)
No video, no transcript — just select English text on any page, right-click, and pick **Add to Lingogram**. The word (plus the surrounding sentence as context) is written to your inbox. If you're not signed in, the toolbar popup opens automatically so you can authorize in one click. Built with a context-menu item + `activeTab`/`scripting` — no broad host permissions, no in-page content script.

### 🔐 Lingogram Account Integration
- "Sign in on Lingogram" opens the web app's `/extension-auth?ext=<extId>` route in a tab. After auth, the tab forwards the Firebase `idToken` + `refreshToken` to the extension via `chrome.runtime.sendMessage` (gated by `externally_connectable` and a build-time origin allowlist).
- The service worker uses the token to append words to `inbox/{uid}/words/*` in Firestore, with per-day rate limits enforced by Firestore Security Rules.
- Words drain into the user's dictionary topic on the Lingogram web app — partial failures stay in the inbox for retry.

### ⌨️ Productivity Hotkeys
- `Shift + D` — toggle Dual / Single mode
- `Shift + S` — swap primary and secondary languages
- `Shift + G` — toggle Guess (Blur) mode
- `Shift + O` — show / hide the sidebar overlay

<img src="apps/rezka/docs/assets/screenshot2.png" width="100%" alt="Interactive Navigation" />

---

## 🛠 Architecture

```
chrome-extension-video-transcripts/
├── apps/
│   ├── rezka/              # Rezka.ag / HDRezka extension
│   ├── youtube/            # YouTube extension
│   └── web/                # Any-site right-click "Add to Lingogram" (no content script)
├── packages/
│   └── shared/             # Code reused by all three extensions
│       ├── src/auth/       # Firebase REST auth, Firestore inbox writer, MV3 SW handoff
│       ├── src/content/    # In-page auth pill, highlight → quick-add overlay (video apps)
│       ├── src/popup/      # "Sign in on Lingogram" popup (html + css + ts)
│       ├── src/prefs.ts    # chrome.storage-backed preferences
│       └── vite-limits.mjs # Build-time daily/term/url limit injection
└── releases/               # Built .zip artifacts (one per extension version)
```

- **Manifest V3** — compliant with Chrome's latest security model. No persistent background page; service worker survives restarts.
- **Vite + TypeScript** — fast builds and type-safe development.
- **Firebase Auth + Firestore** — auth lives in the Lingogram web app (no Firebase SDK in the service worker); tokens are handed to the extension via `externally_connectable`.
- **Rezka-specific interceptor** — smart `.vtt` request capture for Rezka's player patterns.
- **YouTube page-script** — captures `pot` parameters from network calls so VTT URLs can be re-fetched.
- **Web extension** — no content script: a `contextMenus` item in the service worker, with `activeTab` + `scripting` to read the selection/context and show a confirmation toast only on user click.

---

## 🚀 Installation (developer build)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/akarzhavin/chrome-extension-video-transcripts.git
   cd chrome-extension-video-transcripts
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Build the extensions:**
   ```bash
   npm run build                  # builds all, emits zips into releases/
   npm run build --workspace=@video-transcripts/rezka     # one app only
   npm run build --workspace=@video-transcripts/youtube
   npm run build --workspace=@video-transcripts/web
   ```
   Dev builds (point at local Firebase emulators + `http://localhost:5173`):
   ```bash
   npm run build:dev --workspace=@video-transcripts/rezka
   ```
4. **Load into Chrome:**
   - Open `chrome://extensions/`.
   - Enable **Developer mode**.
   - Click **Load unpacked**.
   - Select `apps/rezka/build`, `apps/youtube/build`, or `apps/web/build`.

---

## 🧪 Tests

```bash
npm test                       # jest, all workspaces
npm run type-check             # tsc --noEmit across workspaces
```

---

## 📋 Roadmap
- [ ] Netflix support
- [ ] Anki export from the inbox
- [ ] Built-in dictionary on hover (delegate to dictionary-service)
- [ ] Per-video learning stats

---

<div align="center">
  <p>Made with ❤️ for language learners everywhere.</p>
</div>
