// PIPELINE experiments@1 — throwaway design explorations, NOT store assets.
//
//   node pipelines/experiments@1/render-ru-variants.mjs
//
// Nothing here is uploaded. It exists so a colour/layout idea can be rendered
// and compared without touching a real pipeline's output — kept separate from
// store-en@5 / store-i18n@5 precisely so an exploratory run can never be
// mistaken for, or overwrite, a deliverable.
//
// Same layout and RU copy as store-i18n@5, but the promo.css palette is
// hue-rotated into three moods. Only CSS *colour literals* are transformed
// (hex + rgb/rgba) — the product screenshots are external PNGs and stay
// untouched, so the UI isn't tinted or broken.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, ASSETS, BUILD, CAPTURES, ID, MANIFEST, OUT, requireCaptures } from './lib.mjs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`${ID} — ${MANIFEST.title}\n\n  ${MANIFEST.run}\n\nwrites ${MANIFEST.outputs.dir}/`);
  process.exit(0);
}

// Falls back to the English captures, so require those rather than the RU ones.
requireCaptures(['live-demo-en.png', 'live-demo-guess-en.png', 'live-demo-onboarding-en.png']);

const LOC = 'ru';
const COPY = JSON.parse(fs.readFileSync(path.join(ASSETS, 'promo-copy.json'), 'utf8'));
const BASE_CSS = fs.readFileSync(path.join(ASSETS, 'promo.css'), 'utf8');
const SHOT_DIR = CAPTURES;
const shotUrl = (name) => pathToFileURL(path.join(SHOT_DIR, name)).href;
function shotFor(kind) {
  const name = kind === 'demo' ? `live-demo-${LOC}.png` : `live-demo-${kind}-${LOC}.png`;
  const en = kind === 'demo' ? 'live-demo-en.png' : `live-demo-${kind}-en.png`;
  return shotUrl(fs.existsSync(path.join(SHOT_DIR, name)) ? name : en);
}
const SHOTS = { demo: shotFor('demo'), onboarding: shotFor('onboarding'), guess: shotFor('guess') };

// ── colour transform ─────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
// rotate hue + scale saturation; skip near-greys (the dark backdrops keep depth).
// Either a uniform `dh` rotate, or a `mapHue` fn (piecewise duotone remap).
function shift(r, g, b, { dh, sat, mapHue }) {
  let [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.12) return [r, g, b];           // near-grey → leave dark base alone
  s = clamp(s * sat, 0, 1);
  const nh = mapHue ? mapHue(h) : h + dh;
  return hslToRgb(nh, s, l);
}
// piecewise-linear hue remap from [srcHue → dstHue] anchors (sorted by src)
function makeHueMap(anchors) {
  const a = [...anchors].sort((x, y) => x[0] - y[0]);
  return (h) => {
    if (h <= a[0][0]) return a[0][1];
    if (h >= a[a.length - 1][0]) return a[a.length - 1][1];
    for (let i = 0; i < a.length - 1; i++) {
      if (h >= a[i][0] && h <= a[i + 1][0]) {
        const t = (h - a[i][0]) / (a[i + 1][0] - a[i][0]);
        return a[i][1] + (a[i + 1][1] - a[i][1]) * t;
      }
    }
    return h;
  };
}
function recolor(css, opts) {
  // #rrggbb / #rgb
  css = css.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, hex) => {
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const [nr, ng, nb] = shift(r, g, b, opts);
    return '#' + [nr, ng, nb].map((v) => v.toString(16).padStart(2, '0')).join('');
  });
  // rgb(r,g,b) / rgba(r,g,b,a)
  css = css.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)/g,
    (m, r, g, b, a) => {
      const [nr, ng, nb] = shift(+r, +g, +b, opts);
      return a != null ? `rgba(${nr}, ${ng}, ${nb}${a})` : `rgb(${nr}, ${ng}, ${nb})`;
    });
  return css;
}

const VARIANTS = [
  { id: 'ru-v1', name: 'acid lime / cyan',     dh: -108, sat: 1.15 },
  { id: 'ru-v2', name: 'hot-pink / magenta',   dh:  62,  sat: 1.12 },
  { id: 'ru-v3', name: 'y2k sunset (orange/pink)', dh: 120, sat: 1.18 },
  // v4 — true violet→green diagonal gradient. Instead of recoloring the scattered
  // mesh blobs (which left the green muddy), we replace .bg with an explicit
  // violet(TL)→green(BR) gradient + matching hl/eyebrow, and KEEP the device glow
  // violet so the product panel's purple accent still harmonizes.
  { id: 'ru-v4', name: 'violet → green gradient', css: `
    .theme-1 .bg, .theme-2 .bg, .theme-3 .bg, .theme-4 .bg {
      background:
        radial-gradient(120% 120% at 6% 2%,   rgba(139,92,246,0.70) 0%, transparent 46%),
        radial-gradient(95% 95%  at 96% 8%,    rgba(124,58,237,0.45) 0%, transparent 44%),
        radial-gradient(130% 130% at 100% 100%, rgba(34,197,94,0.62) 0%, transparent 52%),
        radial-gradient(90% 90%  at 62% 108%,  rgba(16,185,129,0.45) 0%, transparent 46%),
        linear-gradient(135deg, #1a0e38 0%, #161038 42%, #0c2a22 100%);
    }
    .hl { background: linear-gradient(90deg, #a78bfa 0%, #6ee7b7 55%, #34d399 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent; }
    .eyebrow { background: linear-gradient(90deg, rgba(139,92,246,0.95), rgba(34,197,94,0.95));
      box-shadow: 0 6px 20px rgba(16,185,129,0.40); }
  ` },

  // v4a — clean HORIZONTAL violet(left)→green(right), smoother/calmer.
  { id: 'ru-v4a', name: 'violet→green · horizontal', css: `
    .theme-1 .bg, .theme-2 .bg, .theme-3 .bg, .theme-4 .bg {
      background:
        radial-gradient(120% 150% at -4% 50%, rgba(139,92,246,0.68) 0%, transparent 56%),
        radial-gradient(120% 150% at 104% 50%, rgba(34,197,94,0.60) 0%, transparent 56%),
        linear-gradient(100deg, #1b0f3a 0%, #141338 42%, #0a2a22 100%);
    }
    .hl { background: linear-gradient(90deg, #a78bfa 0%, #34d399 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent; }
    .eyebrow { background: linear-gradient(90deg, rgba(139,92,246,0.95), rgba(34,197,94,0.95));
      box-shadow: 0 6px 20px rgba(16,185,129,0.40); }
  ` },

  // v4b — acid LIME green side instead of emerald, punchy diagonal.
  { id: 'ru-v4b', name: 'violet→lime · acid', css: `
    .theme-1 .bg, .theme-2 .bg, .theme-3 .bg, .theme-4 .bg {
      background:
        radial-gradient(120% 120% at 4% 0%,    rgba(147,51,234,0.74) 0%, transparent 46%),
        radial-gradient(95% 95%  at 96% 6%,     rgba(124,58,237,0.45) 0%, transparent 44%),
        radial-gradient(130% 130% at 100% 100%, rgba(132,204,22,0.64) 0%, transparent 52%),
        radial-gradient(90% 90%  at 66% 108%,   rgba(163,230,53,0.48) 0%, transparent 46%),
        linear-gradient(135deg, #1d0f40 0%, #16123a 40%, #16250a 100%);
    }
    .hl { background: linear-gradient(90deg, #b794f6 0%, #bef264 55%, #a3e635 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent; }
    .eyebrow { background: linear-gradient(90deg, rgba(147,51,234,0.95), rgba(132,204,22,0.95));
      box-shadow: 0 6px 20px rgba(132,204,22,0.40); }
  ` },

  // v4c — deep EMERALD, balanced 50/50, premium feel.
  { id: 'ru-v4c', name: 'violet→emerald · premium', css: `
    .theme-1 .bg, .theme-2 .bg, .theme-3 .bg, .theme-4 .bg {
      background:
        radial-gradient(120% 120% at 8% 6%,    rgba(124,58,237,0.64) 0%, transparent 50%),
        radial-gradient(120% 120% at 96% 96%,   rgba(5,150,105,0.64) 0%, transparent 52%),
        radial-gradient(100% 100% at 52% 102%,  rgba(16,185,129,0.42) 0%, transparent 48%),
        linear-gradient(150deg, #170d33 0%, #0f1230 46%, #08241f 100%);
    }
    .hl { background: linear-gradient(90deg, #a78bfa 0%, #10b981 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent; }
    .eyebrow { background: linear-gradient(90deg, rgba(124,58,237,0.95), rgba(16,185,129,0.95));
      box-shadow: 0 6px 20px rgba(5,150,105,0.40); }
  ` },
];

// ── slide templates (mirrors render-i18n.mjs, CSS injected inline) ───────────
function head(cssHref) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8" />
<link rel="stylesheet" href="${cssHref}" /></head>`;
}
const T = {
  1: (p, s, h) => `${head(h)}
<body class="theme-1"><div class="slide slide--stack"><div class="bg"></div>
  <div class="copy"><span class="eyebrow">${p('slide1','eyebrow')}</span><h1>${p('slide1','title')}</h1><p>${p('slide1','sub')}</p></div>
  <div class="window"><div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">youtube.com/watch</span></div>
  <div class="window__view"><div class="shot" style="background-image:url('${s.demo}')"></div></div></div>
</div></body></html>`,
  2: (p, s, h) => `${head(h)}
<body class="theme-2"><div class="slide slide--side"><div class="bg"></div>
  <div class="copy"><span class="eyebrow">${p('slide2','eyebrow')}</span><h1>${p('slide2','title')}</h1><p>${p('slide2','sub')}</p></div>
  <div class="stage"><div class="panel"><div class="shot" style="background-image:url('${s.demo}'); left:-1058px; top:0;"></div></div></div>
</div></body></html>`,
  3: (p, s, h) => `${head(h)}
<body class="theme-3"><div class="slide slide--side"><div class="bg"></div>
  <div class="copy"><span class="eyebrow">${p('slide3','eyebrow')}</span><h1>${p('slide3','title')}</h1><p>${p('slide3','sub')}</p></div>
  <div class="stage"><div class="panel"><div class="shot" style="background-image:url('${s.onboarding}'); left:-1058px; top:0;"></div></div></div>
</div></body></html>`,
  4: (p, s, h) => `${head(h)}
<body class="theme-2"><div class="slide slide--side"><div class="bg"></div>
  <div class="copy"><span class="eyebrow">${p('slide4','eyebrow')}</span><h1>${p('slide4','title')}</h1><p>${p('slide4','sub')}</p></div>
  <div class="stage"><div class="videoframe"><div class="shot" style="background-image:url('${s.demo}'); left:-18px; top:-76px;"></div></div></div>
</div></body></html>`,
  5: (p, s, h) => `${head(h)}
<body class="theme-3"><div class="slide slide--side"><div class="bg"></div>
  <div class="copy"><span class="eyebrow">${p('slide5','eyebrow')}</span><h1>${p('slide5','title')}</h1><p>${p('slide5','sub')}</p></div>
  <div class="stage"><div class="panel"><div class="shot" style="background-image:url('${s.guess}'); left:-1058px; top:0;"></div></div></div>
</div></body></html>`,
};
const SLIDES = [1, 2, 3, 4, 5];
function copyFor() {
  const en = COPY.en, l = COPY[LOC] || {};
  return (slide, field) => (l[slide] && l[slide][field] != null ? l[slide][field] : en[slide][field]);
}

// ── render ───────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = copyFor();
const only = process.argv.slice(2);
const todo = only.length ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;
for (const v of todo) {
  const build = path.join(BUILD, v.id);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(OUT, v.id), { recursive: true });
  const cssFile = path.join(build, 'promo.css');
  fs.writeFileSync(cssFile, v.css ? BASE_CSS + '\n' + v.css : recolor(BASE_CSS, v));
  const cssHref = pathToFileURL(cssFile).href;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const file = path.join(build, `slide${n}.html`);
    fs.writeFileSync(file, T[n](p, SHOTS, cssHref));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    const shot = path.join(build, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', '800', '1280', shot, '--out',
      path.join(OUT, v.id, `screenshot-${n}.png`)], { stdio: 'ignore' });
  }
  await ctx.close();
  fs.rmSync(build, { recursive: true, force: true });
  console.log(`✓ ${v.id} — ${v.name}`);
}
await browser.close();
try { fs.rmdirSync(BUILD); } catch {}
console.log(`done → ${MANIFEST.outputs.dir}/`);
