// Does each headline occupy the number of lines its <br>s ask for?
//
//   node pipelines/store-i18n@6/check-titlewrap.mjs [locale...]
//
// WHY THIS EXISTS
// A title is authored as N display lines separated by <br>. If one of those
// lines is too WIDE for the copy column it wraps, and the headline silently
// renders with more lines than designed — "Незнакомое слово?" became two lines,
// so a 3-line title shipped as 4, and Ukrainian as 5.
//
// check-overflow.mjs does NOT catch this: nothing leaves its box, the block
// just grows downward. check-orphans.mjs does not either — it measures the last
// line's width against the widest, and a wrapped line can be perfectly wide.
// So this is a third failure mode with its own check.
//
// It measures the RENDERED height against the computed line-height rather than
// counting characters: a character budget cannot know the font, and it was a
// character budget that let this through — every line was under 24 characters
// and still wrapped.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, ASSETS, BUILD } from './lib.mjs';

const COPY = JSON.parse(fs.readFileSync(path.join(ASSETS, 'promo-copy.json'), 'utf8'));
const argv = process.argv.slice(2);
const locales = argv.length ? argv : Object.keys(COPY).filter((k) => !k.startsWith('_'));

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

const problems = [];
let checked = 0;
for (const loc of locales) {
  for (const n of [1, 2, 3, 4, 5]) {
    const f = path.join(BUILD, loc, `slide${n}.html`);
    if (!fs.existsSync(f)) continue;
    await page.goto(pathToFileURL(f).href, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => {
      const h = document.querySelector('.copy h1');
      if (!h) return null;
      const lh = parseFloat(getComputedStyle(h).lineHeight);
      if (!Number.isFinite(lh) || lh <= 0) return null;
      return {
        // Round, don't truncate: sub-pixel line boxes make a clean 3 read as
        // 2.998, which is how two locales first looked like failures.
        visual: Math.round(h.getBoundingClientRect().height / lh),
        intended: h.innerHTML.split('<br>').length,
        text: h.textContent.trim().replace(/\s+/g, ' '),
      };
    });
    if (!r) continue;
    checked += 1;
    if (r.visual !== r.intended) problems.push({ loc, n, ...r });
  }
}
await browser.close();

for (const p of problems) {
  console.log(`${p.loc} slide${p.n}: authored ${p.intended} lines, renders ${p.visual} — ${p.text}`);
}
console.log(problems.length
  ? `\n${problems.length} wrapped headline(s) of ${checked} checked`
  : `no wrapped headlines (${checked} checked)`);
process.exitCode = problems.length ? 1 : 0;
