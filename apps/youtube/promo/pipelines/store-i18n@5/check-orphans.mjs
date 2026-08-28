// Line COUNT is not the defect — Russian slide 3 renders 5 lines and reads fine.
// What looks broken is an ORPHAN: a last line far shorter than the ones above,
// e.g. Japanese slide 3 ending with a single "せ". Measure the last line's width
// as a fraction of the widest line.
import fs from 'node:fs'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, BUILD } from './lib.mjs';
const locs = process.argv.slice(2);
const b = await chromium.launch({args:['--allow-file-access-from-files']});
const c = await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
const p = await c.newPage();
const out=[];
for (const loc of locs) for (const n of [1,2,3,4]) {
  const f = path.join(BUILD, loc, `slide${n}.html`);
  if (!fs.existsSync(f)) continue;
  await p.goto(pathToFileURL(f).href,{waitUntil:'networkidle'});
  const r = await p.evaluate(() => {
    const h=document.querySelector('.copy h1'); if(!h) return null;
    // Wrap every text node in spans, then group client rects by line.
    const range=document.createRange(); range.selectNodeContents(h);
    const rects=[...range.getClientRects()].filter(r=>r.width>0.5);
    if(rects.length<2) return null;
    const lines=[];
    for(const r of rects){
      const hit=lines.find(l=>Math.abs(l.top-r.top)<4);
      if(hit){hit.left=Math.min(hit.left,r.left);hit.right=Math.max(hit.right,r.right);}
      else lines.push({top:r.top,left:r.left,right:r.right});
    }
    lines.sort((a,b)=>a.top-b.top);
    const widths=lines.map(l=>l.right-l.left);
    const max=Math.max(...widths), last=widths[widths.length-1];
    return {lines:lines.length, ratio:+(last/max).toFixed(2), last:Math.round(last), max:Math.round(max)};
  });
  if (r && r.lines>1 && r.ratio < 0.25) out.push(`${loc} slide${n}: last line ${r.last}px of ${r.max}px (${Math.round(r.ratio*100)}%) — orphan`);
}
await b.close();
console.log(out.length? out.join('\n') : 'no orphaned headline lines');
