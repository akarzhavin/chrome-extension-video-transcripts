// Verifies slide 2's selection swatch actually lands on the word in the OUTPUT.
//
//   node pipelines/store-i18n@5/check-overlay.mjs [locale...]
//
// WHY THIS EXISTS
// The swatch and quick-add pill are drawn over the capture. Their vertical
// position is solved at render time by placeOverlay() (see render.mjs), because
// the active card sits at a different height per locale — a translation row that
// wraps to two lines pushes it down. Measured: en/ru/de put the card at y 371,
// id/sr/vi at 394, kn/ta at 401. Get this wrong and the render still succeeds,
// nothing overflows, and the slide simply shows a swatch floating above the word.
//
// This reads the FINAL screenshot-2.png rather than the build HTML: the position
// is applied by script after layout, so measuring the HTML would test the static
// CSS fallback and not what actually ships.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, CAPTURES } from './lib.mjs';
import { execFileSync } from 'node:child_process';

const locales = process.argv.slice(2);
if (!locales.length) {
  console.error('usage: node check-overlay.mjs <locale>...');
  process.exit(1);
}

// The swatch is an opaque #b3d7ff rectangle — a colour that appears nowhere else
// on the slide. Find it, then assert dark glyph pixels sit inside it.
const SWATCH = [0xb3, 0xd7, 0xff];
const near = (p, q, tol) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol && Math.abs(p[2] - q[2]) < tol;

// How far below the active card's top edge the selection swatch must sit.
// Measured from the English render, which is verified against store-en@5.
const EXPECTED_DELTA = 21;   // measured from out/store-i18n@5/en/screenshot-2.png

const bad = [];
for (const loc of locales) {
  const png = path.join(OUT, loc, 'screenshot-2.png');
  if (!fs.existsSync(png)) { bad.push(`${loc}: no screenshot-2.png`); continue; }

  // Decode via sips -> raw RGB is not available, so use a tiny PPM conversion.
  const ppm = path.join(process.env.TMPDIR || '/tmp', `lg-chk-${loc}.png`);
  fs.copyFileSync(png, ppm);
  const { width, height, data } = readPng(ppm);
  fs.rmSync(ppm, { force: true });

  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = Math.floor(width * 0.55); x < width; x++) {
      const i = (y * width + x) * 3;
      if (near([data[i], data[i + 1], data[i + 2]], SWATCH, 14)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { bad.push(`${loc}: selection swatch not found in screenshot-2.png`); continue; }

  // Neither ink nor "is it lime" discriminates. Measured on vi: the wrong
  // position (one row up) has MORE ink (18.6% vs 16.6%) because it lands on the
  // previous subtitle line, and both positions sit inside the tall lime active
  // card. What does discriminate is the swatch's offset from the card's TOP
  // EDGE — the Spanish line always starts a fixed distance below it.
  //
  // The card top is found by scanning a column that misses the swatch entirely
  // (x1 + 40 is card ground on every locale), so the swatch's own antialiased
  // border cannot be mistaken for the edge.
  const probeX = Math.min(width - 2, x1 + 40);
  const isLime = (x, y) => {
    const i = (y * width + x) * 3;
    return data[i] > 195 && data[i + 1] > 225 && data[i + 2] < 200;
  };
  let cardTop = -1;
  for (let y = y0; y > 0; y--) {
    if (!isLime(probeX, y)) { cardTop = y + 1; break; }
  }
  // Calibrated on English, verified pixel-identical to store-en@5.
  const delta = cardTop < 0 ? -1 : y0 - cardTop;
  if (delta < 0 || Math.abs(delta - EXPECTED_DELTA) > 6) {
    bad.push(`${loc}: swatch is ${delta}px below the card top (expected ~${EXPECTED_DELTA}) — overlay drifted off the word`);
  }
}

// Capture freshness: slides 2 and 3 embed live-demo-<loc>.png / -guess-<loc>.png,
// and a capture predating the redesign shows the OLD product — dark theme, violet
// accent, German as the learning language. Nothing in the rendered pixels flags it.
const enStamp = fs.existsSync(path.join(CAPTURES, 'live-demo-en.png'))
  ? fs.statSync(path.join(CAPTURES, 'live-demo-en.png')).mtimeMs : 0;
for (const loc of locales) {
  for (const kind of ['', 'guess-', 'settings-']) {
    const f = path.join(CAPTURES, `live-demo-${kind}${loc}.png`);
    if (!fs.existsSync(f)) continue;
    if (fs.statSync(f).mtimeMs < enStamp - 24 * 3600 * 1000) {
      bad.push(`${loc}: live-demo-${kind}${loc}.png predates the English capture — stale design`);
    }
  }
}

console.log(bad.length ? bad.join('\n') : `slide 2 overlay lands on the word in all ${locales.length} locale(s); captures current`);
if (bad.length) process.exit(1);

// Minimal PNG reader via `sips` to a raw-friendly format, then parse.
function readPng(file) {
  const tmp = file.replace(/\.png$/, '.tiff');
  execFileSync('sips', ['-s', 'format', 'tiff', file, '--out', tmp], { stdio: 'ignore' });
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return parseTiff(buf);
}

function parseTiff(buf) {
  const le = buf.readUInt16LE(0) === 0x4949;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  let ifd = u32(4);
  const n = u16(ifd);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const val = type === 3 && count === 1 ? u16(e + 8) : u32(e + 8);
    tags[tag] = { val, count, off: e + 8 };
  }
  const width = tags[256].val, height = tags[257].val;
  const spp = tags[277] ? tags[277].val : 3;
  let stripOffsets = tags[273].val;
  if (tags[273].count > 1) stripOffsets = u32(tags[273].val);
  const rows = tags[278] ? tags[278].val : height;
  const out = Buffer.alloc(width * height * 3);
  // Single-strip, uncompressed, 8-bit — what sips emits for these files.
  let src = stripOffsets, dst = 0;
  for (let i = 0; i < width * height; i++) {
    out[dst++] = buf[src]; out[dst++] = buf[src + 1]; out[dst++] = buf[src + 2];
    src += spp;
  }
  void rows;
  return { width, height, data: out };
}
