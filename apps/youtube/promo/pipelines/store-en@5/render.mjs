// PIPELINE store-en@5 — the English Chrome Web Store slide series.
//
//   node pipelines/store-en@5/render.mjs
//
// Everything this pipeline needs is beside it: manifest.json describes it,
// assets/ holds its CSS and brand mark, slide1..5.html hold the English copy,
// lib.mjs is its runtime. The one external dependency is the shared product
// captures (~345 MB), declared in the manifest and checked before we launch a
// browser — see lib.mjs for why they aren't vendored.
//
// Each slide is a self-contained 1280x800 page embedding a real product capture
// on a styled backdrop. Shot at deviceScaleFactor 2 (2560x1600), then
// downscaled by `sips` for crisp text at the CWS spec size.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  chromium, CWS_SCREENSHOT, HERE, ID, MANIFEST, OUT, SHOTS, requireCaptures,
} from './lib.mjs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`${ID} — ${MANIFEST.title}\n\n  ${MANIFEST.run}\n\nwrites ${MANIFEST.outputs.dir}/`);
  process.exit(0);
}

requireCaptures(MANIFEST.inputs.captures.files);

const slides = fs
  .readdirSync(HERE)
  .filter((f) => /^slide\d+\.html$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({
  viewport: { ...CWS_SCREENSHOT },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const file of slides) {
  const n = file.match(/\d+/)[0];
  await page.goto(pathToFileURL(path.join(HERE, file)).href, { waitUntil: 'networkidle' });
  const shot = path.join(SHOTS, `slide${n}.png`);
  await page.screenshot({ path: shot });               // 2560x1600 (deviceScaleFactor 2)
  execFileSync('sips', ['-z', String(CWS_SCREENSHOT.height), String(CWS_SCREENSHOT.width),
    shot, '--out', path.join(OUT, `promo-${n}.png`)], { stdio: 'ignore' });
  // 2x version for the website / landing (the shot already is 2560x1600).
  fs.copyFileSync(shot, path.join(OUT, `promo-${n}@2x.png`));
  console.log('✓ slide' + n);
}

await ctx.close();
await browser.close();
console.log(`done → ${MANIFEST.outputs.dir}/`);
