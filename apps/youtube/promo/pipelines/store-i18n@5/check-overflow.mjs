// Measure real overflow: render every locale's slides and report any element
// whose text spills past its box or past the 1280x800 canvas.
import fs from 'node:fs'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, BUILD } from './lib.mjs';

const locs = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
for (const loc of locs) {
  for (const n of [1,2,3,4]) {
    const f = path.join(BUILD, loc, `slide${n}.html`);
    if (!fs.existsSync(f)) continue;
    await page.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' });
    const bad = await page.evaluate(() => {
      const out = [];
      const check = (sel) => document.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > 1280.5 || r.bottom > 800.5 || r.left < -0.5 || r.top < -0.5)
          out.push({ sel: el.className || el.tagName, why: 'outside canvas',
                     box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'hidden')
          out.push({ sel: el.className || el.tagName, why: `clipped w ${el.scrollWidth}>${el.clientWidth}` });
      });
      check('.copy h1'); check('.copy p'); check('.eyebrow'); check('.callout');
      check('.cap-main'); check('.cap-sub');
      return out;
    });
    bad.forEach((b) => problems.push({ loc, slide: n, ...b }));
  }
}
await browser.close();
if (!problems.length) console.log('no overflow detected');
for (const p of problems) console.log(`${p.loc} slide${p.slide}  ${p.sel}  ${p.why} ${p.box ? JSON.stringify(p.box) : ''}`);
