// Self-contained runtime for this pipeline. Deliberately duplicated in each
// pipeline rather than shared: a pipeline is a frozen recipe for one promo
// generation, and a shared helper would let an edit made for a newer
// generation silently change how an older one renders.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.join(HERE, 'assets');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
export { MANIFEST };

// Playwright isn't a dependency of this repo — reuse the copy installed in the
// sibling "Disable automatic tab discarding" project, where this tooling began.
const require = createRequire(import.meta.url);
const PW_FALLBACK =
  '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = require(PW_FALLBACK));
  } catch {
    console.error('Playwright not found. Install it, or check the fallback path in lib.mjs:');
    console.error('  ' + PW_FALLBACK);
    process.exit(1);
  }
}
export { chromium };

// The Chrome Web Store screenshot canvas. Shot at deviceScaleFactor 2, then
// downscaled with `sips`.
export const CWS_SCREENSHOT = { width: 1280, height: 800 };

// Output roots. A pipeline writes ONLY under its own name, so two pipelines —
// or two versions of one — can run without touching each other's files.
const PROMO_ROOT = path.dirname(path.dirname(HERE));
export const ID = MANIFEST.name + '@' + MANIFEST.version.split('.')[0];
export const OUT = path.join(PROMO_ROOT, 'out', ID);
export const SHOTS = path.join(PROMO_ROOT, 'shots', ID);
export const BUILD = path.join(PROMO_ROOT, '.build', ID);

// Unlike every other pipeline, this one needs NO shared product captures: the
// panel is rebuilt in HTML and the backdrop is vendored in assets/. That is the
// whole reason it exists — see assets/panel.css. So there is no requireCaptures
// here; a missing input is a missing file in assets/, which fails at render.
