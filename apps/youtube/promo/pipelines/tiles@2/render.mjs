// PIPELINE tiles@2 — the Chrome Web Store marketing tiles.
//
//   node pipelines/tiles@2/render.mjs
//
// Everything this pipeline needs is beside it: manifest.json describes it,
// assets/ holds tiles.css and the brand mark, lib.mjs is its runtime. The
// product capture the marquee reuses is declared in the manifest.
//
// Tiles are NOT screenshots: different canvas sizes, different CSS, and the
// store treats them as a separate asset class — hence their own pipeline.
// Rendered at 2x then downscaled; the alpha channel is stripped with PIL so the
// output is opaque 24-bit PNG (the store rejects PNGs with alpha).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, HERE, ID, MANIFEST, OUT, SHOTS, requireCaptures } from './lib.mjs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`${ID} — ${MANIFEST.title}\n\n  ${MANIFEST.run}\n\nwrites ${MANIFEST.outputs.dir}/`);
  process.exit(0);
}

requireCaptures(MANIFEST.inputs.captures.files);

// tile-small.png is NOT rendered from HTML: the 440x280 tile is a downscale of
// the hand-made key art (see make-small-tile.py). Rendering tile-small.html
// here would silently overwrite it on every run.
const TILES = [
  { file: 'tile-marquee.html', out: 'tile-marquee.png', w: 1400, h: 560 },
];

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

for (const t of TILES) {
  const ctx = await browser.newContext({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(HERE, t.file)).href, { waitUntil: 'networkidle' });
  const shot = path.join(SHOTS, t.out);
  await page.screenshot({ path: shot });                     // 2× of the canvas
  const out = path.join(OUT, t.out);
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
console.log(`done → ${MANIFEST.outputs.dir}/`);
