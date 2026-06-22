// Localized Chrome Web Store screenshots for the YouTube extension.
//
// Renders the extension's real sidebar UI (real CSS + real _locales strings)
// at exactly 1280x800 and writes spec-compliant JPEGs (no alpha) — one per
// locale x scene. Deterministic: no login, no live YouTube, no flaky captions.
//
// Usage (from repo root):
//   npm install --no-save puppeteer-core
//   node apps/youtube/screenshots/capture.mjs --langs en,de,ja,ar --scenes onboarding,nosubs
//
// Flags:
//   --langs   comma list of _locales dir names, or "all"      (default: en)
//   --scenes  onboarding | nosubs | searching (comma list)    (default: onboarding,nosubs)
//   --picks   learning=es,native=en  (pre-selected langs in onboarding picker)
//   --out     output dir                                      (default: <here>/out)
//   --chrome  path to Chrome binary                           (default: macOS system Chrome)
import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '..', '_locales');
const HARNESS = pathToFileURL(join(HERE, 'harness.html')).href;
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

// Language options shown in the picker (mirrors SUPPORTED_LANGUAGES in
// packages/shared/src/languages.ts — endonyms are not localized there).
const OPTIONS = [
  ['en','English','English'],['es','Spanish','Español'],['pt','Portuguese','Português'],
  ['fr','French','Français'],['de','German','Deutsch'],['it','Italian','Italiano'],
  ['nl','Dutch','Nederlands'],['ru','Russian','Русский'],['uk','Ukrainian','Українська'],
  ['pl','Polish','Polski'],['tr','Turkish','Türkçe'],['ja','Japanese','日本語'],
  ['ko','Korean','한국어'],['zh','Chinese','中文'],['ar','Arabic','العربية'],
  ['hi','Hindi','हिन्दी'],
].map(([code,label,native]) => ({ code, label, native }));

const KEYS = ['ytOnboardingTitle','ytOnboardingText','ytLearningLabel','ytNativeLabel',
  'ytSelectPlaceholder','ytSearchingTitle','ytSearchingText','ytNoSubsTitle','ytNoSubsText','ytSearchAgain'];

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`)) ||
    (process.argv.includes(`--${name}`) ? `--${name}=${process.argv[process.argv.indexOf(`--${name}`)+1]}` : null);
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}

const scenes = arg('scenes', 'onboarding,nosubs').split(',').map((s) => s.trim()).filter(Boolean);
const out = arg('out', join(HERE, 'out'));
const chromePath = arg('chrome', DEFAULT_CHROME);
const picksRaw = arg('picks', 'learning=es,native=en');
const picks = Object.fromEntries(picksRaw.split(',').map((p) => p.split('=')));

let langs = arg('langs', 'en');
langs = langs === 'all'
  ? readdirSync(LOCALES).filter((d) => existsSync(join(LOCALES, d, 'messages.json')))
  : langs.split(',').map((s) => s.trim()).filter(Boolean);

function strings(lang) {
  const j = JSON.parse(readFileSync(join(LOCALES, lang, 'messages.json'), 'utf8'));
  const s = {};
  for (const k of KEYS) s[k] = j[k]?.message ?? k;
  return s;
}

mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(HARNESS, { waitUntil: 'load' });

let n = 0;
for (const lang of langs) {
  const s = strings(lang);
  for (const scene of scenes) {
    await page.evaluate((p) => window.render(p), { scene, s, options: OPTIONS, picks, rtl: RTL.has(lang.split('_')[0]) });
    await new Promise((r) => setTimeout(r, 80)); // let fonts/layout settle
    const file = join(out, `youtube-${scene}-${lang}-1280x800.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    n++;
    console.log('✓', file.replace(HERE + '/', ''));
  }
}

await browser.close();
console.log(`\nDone: ${n} screenshot(s) in ${out}`);
