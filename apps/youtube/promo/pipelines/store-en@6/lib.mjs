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

// Product captures live outside any pipeline: 162 files / ~345 MB shared by
// all of them, far too heavy to vendor per pipeline. The manifest lists the
// ones this pipeline needs so a missing capture fails loudly here, at startup,
// instead of rendering a blank frame twenty minutes in.
export const CAPTURES = path.resolve(HERE, MANIFEST.inputs.captures.dir);

export function requireCaptures(names) {
  const missing = names.filter((n) => !fs.existsSync(path.join(CAPTURES, n)));
  if (missing.length) {
    console.error(`${ID}: missing ${missing.length} capture(s) in ${CAPTURES}`);
    for (const m of missing.slice(0, 10)) console.error('  ' + m);
    if (missing.length > 10) console.error(`  … and ${missing.length - 10} more`);
    console.error('\nrecapture with:\n  ' + MANIFEST.inputs.captures.recapture);
    process.exit(1);
  }
}
