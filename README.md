<div align="center">
  <img src="src/assets/icons/icon128.png" width="128" height="128" alt="Logo" />
  <h1>Learn languages while watching Rezka</h1>
  <p><b>Interactive transcripts and dual subtitles to help you understand every word while watching Rezka.</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://chrome.google.com/webstore)
  [![Vite](https://img.shields.io/badge/Build-Vite-%23646CFF.svg)](https://vitejs.dev/)
  [![TypeScript](https://img.shields.io/badge/Language-TypeScript-%233178C6.svg)](https://www.typescriptlang.org/)
  [![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-lightgrey.svg)](PRIVACY_POLICY.md)
</div>

---

## 🌟 Overview

**Rezka Subtitle Reader** is a specialized Chrome extension tailored for the **Rezka.ag** (and HDRezka) platform. It transforms your movie-watching experience into an active language learning session by intercepting VTT subtitles and presenting them in a clean, interactive, and synchronized sidebar.

No more struggling to catch every word — see the full context, click to jump, and learn naturally while watching your favorite content.

---

## 🚀 How it Works

The extension seamlessly integrates with the Rezka video player:
1.  **Open any video** on Rezka.ag or HDRezka.
2.  **Enable Subtitles** in the native player settings (e.g., select English). The extension automatically captures the track.
3.  **Add a Second Track** by switching the player to another language (e.g., Russian). The extension merges them into **Dual Mode**.
4.  **Interactive Sidebar**: Use the sidebar to scroll, search, and navigate the video by clicking on sentences.

---

## ✨ Key Features

### 📚 Synchronized Transcript Sidebar
The entire video text is available in an interactive sidebar. The current phrase is automatically highlighted and scrolled into view as the video plays.

<img src="docs/assets/screenshot1.png" width="100%" alt="Transcript Sidebar View" />

### 🌐 Dynamic Dual Subtitles
Learn by comparing two languages side-by-side. Once you load two different tracks in the original player, the extension merges them for maximum contextual understanding.

### 🖱️ Interactive Navigation & Seeking
Click any sentence in the transcript to instantly jump to that specific moment in the video. Perfect for repeating difficult phrases or skipping ahead.

### 🎓 Smart Learning Modes
*   **Dual Mode**: See both languages at once.
*   **Guess Mode (Blur)**: Hide the primary language and reveal it word-by-word or on hover to test your listening skills.

### ⌨️ Productivity Hotkeys
*   `Shift + D`: Toggle Dual/Single mode.
*   `Shift + S`: Swap primary and secondary languages.
*   `Shift + G`: Toggle Guess (Blur) mode.
*   `Shift + O`: Show/Hide the sidebar overlay.

<img src="docs/assets/screenshot2.png" width="100%" alt="Interactive Navigation" />

---

## 🛠 Architecture

The project is built with modern technologies focusing on performance and reliability:

- **Manifest V3**: Compliant with the latest Chrome security standards.
- **Vite + TypeScript**: Fast builds and type-safe development.
- **Rezka-Specific Interceptor**: Smart `.vtt` request interception tailored for Rezka's player patterns.
- **Vanilla DOM**: Maximum performance without heavy framework overhead.

---

## 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/akarzhavin/chrome-extension-video-transcripts.git
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Build the project:**
   ```bash
   npm run build
   ```
4. **Load into Chrome:**
   - Open `chrome://extensions/`.
   - Enable **Developer mode**.
   - Click **Load unpacked**.
   - Select the `build` folder from the project root.

---

## 📋 Roadmap
- [ ] Support for YouTube and Netflix
- [ ] Anki integration for quick card creation
- [ ] Built-in dictionary on hover
- [ ] Export transcripts to PDF/Markdown

---

<div align="center">
  <p>Made with ❤️ for language learners everywhere.</p>
</div>
