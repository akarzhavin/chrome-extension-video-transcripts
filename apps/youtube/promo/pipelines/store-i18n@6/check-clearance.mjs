// THE FOURTH CHECK: does the copy block clear the CAPTIONS and the HOVER CARD?
//
// The three checks that came before it all passed a slide whose paragraph ran
// underneath the on-screen captions (ml, id) and eight more whose paragraph
// touched the hover card with 0-11px to spare (ar, fa, he, nl, ja, ko, ca, ro).
// None of them is looking for this:
//   check-overflow   measures each element against its OWN box
//   check-titlewrap  compares authored <br> count to rendered line count
//   check-orphans    looks for a lone word on the last line
//   fitcheck         measures one title line against the column width
// Every one of those is about a single element. This is about the gap BETWEEN
// two of them, which is the failure a taller headline actually produces: the
// block grows downward into its neighbours while every element stays valid.
//
// RTL IS A DIFFERENT PROBLEM, AND THE OBVIOUS FIX DOES NOT WORK THERE. In an
// RTL locale (.copy gets direction:rtl; text-align:right) every paragraph line
// is flush against the box's RIGHT edge — the edge the hover card sits beside —
// no matter how short the text is. Measured on ar: as shipped the line ends at
// 504px; doubled it still ends at 504px; cut to one word it STILL ends at 504px.
// So shortening the sub cannot move an RTL paragraph away from the card. The
// only lever is the TITLE: a shorter title raises the vertically-centred block
// until the paragraph clears the card's vertical band. For ar/fa/he a two-line
// title clears it and a three-line one does not (measured: 0px at three lines),
// which is why those three locales run shorter than the rest of the series.
//
// Run:  node pipelines/store-i18n@6/check-clearance.mjs [locales…]
// Needs KEEP_BUILD=1 on the render, like fitcheck.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PW = '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require(PW)); }
const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const COPY = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipelines/store-i18n@6/assets/promo-copy.json'), 'utf8'));
const locales = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(COPY).filter(k => !k.startsWith('_'));
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const rows = [];
for (const loc of locales) {
  const f = path.join(ROOT, '.build/store-i18n@6', loc, 'slide5.html');
  if (!fs.existsSync(f)) { rows.push({ loc, missing: true }); continue; }
  await page.goto(pathToFileURL(f).href, { waitUntil: 'domcontentloaded' });
  rows.push({ loc, ...await page.evaluate(() => {
    const h1 = document.querySelector('.copy h1');
    const copy = document.querySelector('.copy').getBoundingClientRect();
    const cap = document.querySelector('.captions').getBoundingClientRect();
    const card = document.querySelector('.hovercard').getBoundingClientRect();
    const rng = document.createRange(); rng.selectNodeContents(document.querySelector('.copy p'));
    const near = [...rng.getClientRects()].filter(x => x.bottom > card.top && x.top < card.bottom);
    return {
      lines: Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)),
      top: Math.round(copy.top),
      toCaptions: Math.round(cap.top - copy.bottom),
      toCard: near.length ? Math.round(card.left - Math.max(...near.map(x => x.right))) : null,
    };
  }) });
}
await browser.close();
const bad = rows.filter(r => r.missing || r.toCaptions < 12 || r.top < 12 || (r.toCard !== null && r.toCard < 12));
for (const r of rows.sort((a, b) => (a.toCaptions ?? -999) - (b.toCaptions ?? -999)).slice(0, 14))
  console.log(`${r.loc.padEnd(7)} ${String(r.lines).padStart(2)} строк  верх ${String(r.top).padStart(4)}  до субтитров ${String(r.toCaptions).padStart(4)}px  до карточки ${r.toCard === null ? '—' : r.toCard + 'px'}`);
console.log(bad.length ? `\nПРОБЛЕМНЫХ: ${bad.length} — ${bad.map(b => b.loc).join(' ')}` : `\nвсе ${rows.length} чисто`);
