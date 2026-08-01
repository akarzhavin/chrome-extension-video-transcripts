// Responsive audit: captures the landing, login and register pages at 12
// widths (320 → 1920) and writes full-page shots to screens/ plus per-section
// crops to crops/. Both output dirs are gitignored; this script is not.
//
//   cd apps/site && npm run build
//   (cd build && python3 -m http.server 8899 --bind 127.0.0.1) &
//   npx playwright@latest node apps/site/screenshots/responsive/shoot.mjs
//
// playwright is NOT a dependency of this repo — run it via npx, or point
// NODE_PATH at a checkout that has it.
import { chromium } from 'playwright';
const OUT = new URL('.', import.meta.url).pathname;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DEVICES = [
  { n:'01-iphone-se1',    w:320,  h:568,  t:true  },
  { n:'02-iphone-se',     w:375,  h:667,  t:true  },
  { n:'03-iphone-14',     w:393,  h:852,  t:true  },
  { n:'04-pixel-7',       w:412,  h:915,  t:true  },
  { n:'05-iphone-promax', w:430,  h:932,  t:true  },
  { n:'06-ipad-mini',     w:768,  h:1024, t:true  },
  { n:'07-ipad-air',      w:820,  h:1180, t:true  },
  { n:'08-ipad-pro-12',   w:1024, h:1366, t:true  },
  { n:'09-ipad-landscape',w:1180, h:820,  t:true  },
  { n:'10-laptop',        w:1280, h:800,  t:false },
  { n:'11-desktop',       w:1440, h:900,  t:false },
  { n:'12-desktop-wide',  w:1920, h:1080, t:false },
];
const SECTIONS = [['header','header.site'],['hero','.hero'],['editions','#platforms'],
                  ['how','#how'],['dict','#dictionary'],['faq','#faq'],['footer','footer.site']];

const b = await chromium.launch();
let issues = 0;
for (const d of DEVICES) {
  const ctx = await b.newContext({ viewport:{width:d.w,height:d.h}, deviceScaleFactor:2,
    isMobile:d.t, hasTouch:d.t, userAgent: d.t ? UA : undefined });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8899/', { waitUntil:'load' });
  await p.waitForTimeout(2200);
  await p.addStyleTag({content:'*,*::before,*::after{animation-play-state:paused!important;transition:none!important}'});
  await p.evaluate(async()=>{ window.scrollTo(0,document.body.scrollHeight);
    await new Promise(r=>setTimeout(r,600)); window.scrollTo(0,0);
    await new Promise(r=>setTimeout(r,300)); });
  const hs = await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
  if (hs) issues++;
  await p.screenshot({ path:`${OUT}screens/landing-${d.n}-${d.w}.png`, fullPage:true });
  for (const [tag,sel] of SECTIONS) {
    const el = await p.$(sel); if(!el) continue;
    await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    try { await el.screenshot({ path:`${OUT}crops/${d.n}-${d.w}--${tag}.png` }); } catch {}
  }
  console.log(`${d.n.padEnd(20)} ${String(d.w).padStart(4)}px  h-scroll=${hs?'YES ✗':'no'}`);
  await ctx.close();

  // auth pages
  for (const [tag,path] of [['login','/login/'],['register','/register/']]) {
    const c2 = await b.newContext({ viewport:{width:d.w,height:d.h}, deviceScaleFactor:2,
      isMobile:d.t, hasTouch:d.t, userAgent: d.t ? UA : undefined });
    const p2 = await c2.newPage();
    await p2.goto('http://127.0.0.1:8899'+path,{waitUntil:'load'});
    await p2.waitForTimeout(1200);
    await p2.screenshot({ path:`${OUT}screens/${tag}-${d.n}-${d.w}.png`, fullPage:true });
    const card = await p2.$('.auth-card');
    if (card) { try { await card.screenshot({ path:`${OUT}crops/${d.n}-${d.w}--${tag}.png` }); } catch {} }
    await c2.close();
  }
}
await b.close();
console.log(issues ? `\n${issues} viewports with h-scroll` : '\nno horizontal scroll anywhere');
