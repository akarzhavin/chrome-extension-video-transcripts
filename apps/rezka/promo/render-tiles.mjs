// Render the Chrome Web Store promo tiles at their exact canvas sizes, as
// 24-bit PNG WITHOUT alpha (the store requires JPEG or 24-bit no-alpha PNG).
//
//   node render-tiles.mjs   → out/tile-small.png (440×280), out/tile-marquee.png (1400×560)
//
// Each tile is shot at deviceScaleFactor 2 then downscaled with `sips`; the
// alpha channel is stripped with PIL (Python) so the output is opaque 24-bit.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Playwright isn't a dep of this repo — override via $PLAYWRIGHT_PATH; the
// fallback points at the sibling project where this tooling was originally run.
const PW_FALLBACK =
  process.env.PLAYWRIGHT_PATH ||
  '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = require(PW_FALLBACK)); }

const TILES = [
  { file: 'tile-small.html', out: 'tile-small.png', w: 440, h: 280 },
  { file: 'tile-marquee.html', out: 'tile-marquee.png', w: 1400, h: 560 },
];

fs.mkdirSync(path.join(HERE, 'shots'), { recursive: true });
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

for (const t of TILES) {
  const ctx = await browser.newContext({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(HERE, t.file)).href, { waitUntil: 'networkidle' });
  const shot = path.join(HERE, 'shots', t.out);
  await page.screenshot({ path: shot });                     // 2× of the canvas
  const out = path.join(HERE, 'out', t.out);
  execFileSync('sips', ['-z', String(t.h), String(t.w), shot, '--out', out], { stdio: 'ignore' });
  // Strip alpha → opaque 24-bit PNG (composite on white to match the light bg).
  execFileSync('python3', ['-c',
    `from PIL import Image;` +
    `im=Image.open(${JSON.stringify(out)}).convert('RGBA');` +
    `bg=Image.new('RGB',im.size,(255,255,255));bg.paste(im,mask=im.split()[3]);` +
    `bg.save(${JSON.stringify(out)})`], { stdio: 'ignore' });
  await ctx.close();
  console.log(`✓ ${t.out} (${t.w}×${t.h})`);
}

await browser.close();
console.log('done → out/');
