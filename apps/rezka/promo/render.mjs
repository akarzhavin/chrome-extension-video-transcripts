// Render the Lingogram promo slides to Chrome Web Store-sized PNGs.
//
//   node render.mjs            # render slide1..N → out/promo-<n>.png (1280×800)
//
// Each slide is a self-contained 1280×800 HTML page that embeds the REAL
// product captures from ../screenshots/out-live/ on a styled backdrop.
// We screenshot at deviceScaleFactor 2 (2560×1600) then downscale to 1280×800
// with `sips` for crisp text at the CWS spec size.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Playwright isn't a dep of this repo — reuse the copy installed in the sibling
// "Disable automatic tab discarding" project (where the promo tooling lives).
const require = createRequire(import.meta.url);
const PW_FALLBACK =
  '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = require(PW_FALLBACK));
}

const slides = fs
  .readdirSync(HERE)
  .filter((f) => /^slide\d+\.html$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

fs.mkdirSync(path.join(HERE, 'shots'), { recursive: true });
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const file of slides) {
  const n = file.match(/\d+/)[0];
  const url = pathToFileURL(path.join(HERE, file)).href;
  await page.goto(url, { waitUntil: 'networkidle' });
  const shot = path.join(HERE, 'shots', `slide${n}.png`);
  await page.screenshot({ path: shot });               // 2560×1600 (deviceScaleFactor 2)
  // Store size (CWS spec): 1280×800.
  execFileSync('sips', ['-z', '800', '1280', shot, '--out',
    path.join(HERE, 'out', `promo-${n}.png`)], { stdio: 'ignore' });
  // 2× version for the website / landing (the shot already is 2560×1600).
  fs.copyFileSync(shot, path.join(HERE, 'out', `promo-${n}@2x.png`));
  console.log('✓ slide' + n);
}

await ctx.close();
await browser.close();
console.log('done → out/');
