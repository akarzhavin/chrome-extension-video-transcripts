// PIPELINE fullscreen@1 — the product edge to edge, over swappable footage.
//
//   node pipelines/fullscreen@1/render.mjs
//   node pipelines/fullscreen@1/render.mjs --backdrop ~/shots/podcast.jpg
//   node pipelines/fullscreen@1/render.mjs --variant warm
//
// The one pipeline that reads no shared product capture. The panel is rebuilt
// in HTML (assets/panel.css) so the backdrop is an input rather than pixels
// welded behind a screenshot — see manifest.json "whyRebuiltNotCaptured".
//
// --backdrop copies the given image over assets/backdrop.jpg, so the vendored
// asset always matches what was last rendered and the slide stays reproducible
// from its own folder.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, CWS_SCREENSHOT, HERE, ID, MANIFEST, OUT, SHOTS } from './lib.mjs';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`${ID} — ${MANIFEST.title}\n\n  ${MANIFEST.run}\n\nwrites ${MANIFEST.outputs.dir}/`);
  process.exit(0);
}

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : null; };

// --variant warm layers assets/warm.css over the base panel: same geometry and
// accents, warmer greys. Rendered to its own filename so variants sit side by
// side rather than overwriting one another.
const variant = arg('variant') || 'base';
if (!['base', 'warm'].includes(variant)) {
  console.error(`unknown --variant ${variant} (expected: base, warm)`);
  process.exit(1);
}
const name = variant === 'base' ? 'fullscreen' : `fullscreen-${variant}`;

const backdrop = arg('backdrop');
if (backdrop) {
  const src = path.resolve(backdrop.replace(/^~/, process.env.HOME));
  if (!fs.existsSync(src)) { console.error(`backdrop not found: ${src}`); process.exit(1); }
  fs.copyFileSync(src, path.join(HERE, 'assets', 'backdrop.jpg'));
  console.log(`backdrop ← ${src}`);
}

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { ...CWS_SCREENSHOT }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// The variant sheet is injected into a temp copy of slide.html rather than
// added with page.addStyleTag: the screenshot must come from a file that can be
// opened by hand and look identical.
const html = fs.readFileSync(path.join(HERE, 'slide.html'), 'utf8').replace(
  '<!-- VARIANT -->',
  variant === 'base' ? '' : `<link rel="stylesheet" href="assets/${variant}.css" />`);
const page_file = path.join(HERE, `.slide.${variant}.html`);
fs.writeFileSync(page_file, html);

await page.goto(pathToFileURL(page_file).href, { waitUntil: 'networkidle' });
const shot = path.join(SHOTS, `${name}.png`);
await page.screenshot({ path: shot });                 // 2560x1600 (deviceScaleFactor 2)
execFileSync('sips', ['-z', String(CWS_SCREENSHOT.height), String(CWS_SCREENSHOT.width),
  shot, '--out', path.join(OUT, `${name}.png`)], { stdio: 'ignore' });
fs.copyFileSync(shot, path.join(OUT, `${name}@2x.png`));
fs.unlinkSync(page_file);
console.log(`✓ ${name}`);

await ctx.close();
await browser.close();
console.log(`done → ${MANIFEST.outputs.dir}/`);
