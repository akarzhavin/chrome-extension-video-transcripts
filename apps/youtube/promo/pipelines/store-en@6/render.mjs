// PIPELINE store-en@6 — the English Chrome Web Store slide series.
//
//   node pipelines/store-en@6/render.mjs
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

// ── Slide 3 is not this pipeline's own render ───────────────────────────────
// It is fullscreen@1's guess-mode frame: the same message as slide3.html, shot
// as a fullscreen frame instead of a panel crop, and chosen over the panel crop
// on 2026-08-27.
//
// In v5 that substitution lived in a person's memory and in a knownIssues note
// telling them to `cp` the file back after every run. That is a step which is
// only ever skipped once — and skipping it silently swaps a shipped slide for a
// different picture, with a green run and no warning. So it is done here, by
// the pipeline that would otherwise clobber it, and it fails loudly rather than
// leaving the wrong frame in place.
// Slide 5 arrives the same way, and for a related reason: the word screen has
// no panel-crop form that works. A short dictionary entry leaves the sidebar's
// lower half empty, so a cropped device reads as a chopped-off panel and a
// whole one reads as half-loaded. In the fullscreen frame the panel runs the
// full height by construction, and the slide matches slides 1 and 3.
const SUBSTITUTIONS = [
  { slide: 3, from: 'fullscreen-guess.png', to: 'promo-3.png' },
  { slide: 3, from: 'fullscreen-guess@2x.png', to: 'promo-3@2x.png' },
  { slide: 5, from: 'fullscreen-word.png', to: 'promo-5.png' },
  { slide: 5, from: 'fullscreen-word@2x.png', to: 'promo-5@2x.png' },
];
const FULLSCREEN_OUT = path.join(path.dirname(path.dirname(HERE)), 'out', 'fullscreen@1');
for (const s of SUBSTITUTIONS) {
  const src = path.join(FULLSCREEN_OUT, s.from);
  if (!fs.existsSync(src)) {
    console.error(`\n! slide ${s.slide}: ${s.from} is missing from ${FULLSCREEN_OUT}`);
    console.error(`  ${s.to} would then be missing, or stale from an earlier run.`);
    console.error(`  Re-render it with: node pipelines/fullscreen@1/render.mjs --variant ${s.slide === 3 ? 'guess' : 'word'}`);
    process.exitCode = 1;
    continue;
  }
  fs.copyFileSync(src, path.join(OUT, s.to));
  console.log(`✓ slide ${s.slide} ← fullscreen@1/${s.from}`);
}

console.log(`done → ${MANIFEST.outputs.dir}/`);
