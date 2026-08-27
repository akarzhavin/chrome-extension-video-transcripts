// Capture promo demo-mode shots on a REAL YouTube page whose (bot-walled) player
// is covered by our own local CC-BY Big Buck Bunny clip.
//
//   node capture-backdrop.mjs --locale de --learn fr --native de
//   node capture-backdrop.mjs --locale ja --learn zh_CN --native ja --modes sidebar,guess
//
// WHY THIS EXISTS (2026-07-14). YouTube bot-walls signed-out automation: the
// player renders "Sign in to confirm you're not a bot" instead of video, which
// made capture-demo.mjs unusable for slides 1/4 (the ones that show the player)
// and forced the hand-built live-demo-en-composite.png. The wall is beatable
// without an account:
//
//   1. #error-screen (yt-playability-error-supported-renderers) is a SIBLING of
//      #movie_player inside #player — NOT an ancestor. Hide that node only;
//      hiding an ancestor takes the player (and our backdrop) with it.
//   2. YouTube flips the blocked player subtree to visibility:hidden and parks
//      its own <video> offscreen (y:-292). Force visibility back on #movie_player
//      and on our backdrop <video>.
//   3. Our clip is served from a youtube.com URL via ctx.route (same-origin, no
//      mixed-content block) + bypassCSP — same trick as promo/record-screencast.mjs.
//   4. Re-fire demo mode AFTER the backdrop attaches so SidebarUI.updateOverlay()
//      re-parents #vtt-video-overlay onto #movie_player — otherwise the dual
//      subtitle lines follow YT's offscreen <video> and never appear on frame.
//
// Backs up out-live/ before writing: the directory is NOT under git (see
// .gitignore) and an earlier run of capture-demo.mjs destroyed the de captures
// with no way back. Restore with: cp out-live.bak/<file> out-live/
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const PW='/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium; try{({chromium}=await import('playwright'))}catch{({chromium}=require(PW))}

const ROOT='/Users/aliaksandrkarzhavin/workspace/chrome-extentions/lingogram/apps/youtube';
const BUILD=join(ROOT,'build');
const ABP=join(ROOT,'screenshots','vendor','adblock-plus');
const EXTS=existsSync(join(ABP,'manifest.json'))?`${BUILD},${ABP}`:BUILD;
const OUT=join(ROOT,'screenshots','out-live');
const CLIP=join(ROOT,'promo','video','bbb-clip.mp4');
const BBB='https://www.youtube.com/__lingogram_backdrop.mp4';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i!==-1?process.argv[i+1]:d};

const loc=arg('locale','de'), learn=arg('learn','fr'), native=arg('native','de');
const video=arg('video','kJQP7kiw5Fk');
const modes=arg('modes','sidebar,guess,onboarding').split(',');
// --theme light injects screenshots/light-theme.capture.css into the page: the
// store palette repainted onto the (dark-only) in-page UI, for CAPTURE ONLY.
// Nothing here ships — see the header of that file.
const theme=arg('theme','dark');
// --class vtt-light applies the product's own light theme (the shipped one,
// via the URL flag) instead of the capture-only override sheet.
const extraClass=arg('class','');
// --theme-pref light|dark|auto picks the theme through the panel's OWN Theme
// control (Settings → Theme), rather than forcing the class. Needed for the
// settings shot: --class paints the panel light but leaves the stored pref on
// 'dark', so the Theme row would read "Dark" on a visibly light panel.
const themePref=arg('theme-pref','');
const THEME_CSS=theme==='light'
  ? readFileSync(join(ROOT,'screenshots','light-theme.capture.css'),'utf8')
  : null;
const chromeLocale=loc.replace('_','-');
// 'settings' is not a demo state — the extension only knows sidebar/guess/
// onboarding. It is the sidebar state with the settings panel opened by
// clicking #vtt-settings-btn, which is how a user reaches it too.
const demoModeFor=m=>m==='settings'?'sidebar':m;
const hash=m=>(m==='onboarding'?'vtt-demo-onboarding':m==='guess'?'vtt-demo-guess':'vtt-demo')+`?learn=${learn}&native=${native}`;
const outFor=m=>m==='sidebar'?`live-demo-${loc}.png`:`live-demo-${m}-${loc}.png`;

// Snapshot out-live/ before overwriting anything — it is gitignored, so a bad
// run is otherwise unrecoverable.
const BAK=join(ROOT,'screenshots','out-live.bak');
if(existsSync(OUT)){ mkdirSync(BAK,{recursive:true});
  for(const f of readdirSync(OUT)) if(f.endsWith('.png')) copyFileSync(join(OUT,f),join(BAK,f));
  console.log('backed up out-live/ → out-live.bak/');
}

const ctx=await chromium.launchPersistentContext(`/tmp/lg-shot-${loc}`,{
  headless:false, viewport:{width:1280,height:800}, deviceScaleFactor:2, bypassCSP:true,
  locale:chromeLocale,
  args:['--headless=new',`--disable-extensions-except=${EXTS}`,`--load-extension=${EXTS}`,
    '--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required',
    '--mute-audio','--hide-scrollbars',`--lang=${chromeLocale}`],
});
await ctx.route(BBB,r=>r.fulfill({path:CLIP,contentType:'video/mp4'}));
// The light sheet is (re)attached after each navigation rather than via
// addInitScript: YouTube is an SPA and the extension mounts its own sheet from
// a content script, so a style added at document_start gets outranked or
// dropped. Appending last to <head> AFTER the panel exists wins at equal
// specificity, and the interval survives YT's client-side route changes.
const applyTheme = async (pg) => {
  if(!THEME_CSS) return;
  await pg.evaluate(css=>{
    const add=()=>{ let el=document.getElementById('lg-capture-theme');
      if(!el){ el=document.createElement('style'); el.id='lg-capture-theme'; el.textContent=css; }
      if(document.head.lastElementChild!==el) document.head.appendChild(el); };
    add(); if(!window.__lgThemeTimer) window.__lgThemeTimer=setInterval(add,500);
  }, THEME_CSS);
};
await sleep(2500);
let [sw]=ctx.serviceWorkers(); if(!sw) await ctx.waitForEvent('serviceworker',{timeout:15000}).catch(()=>null);
await ctx.addCookies([
 {name:'SOCS',value:'CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',domain:'.youtube.com',path:'/'},
 {name:'CONSENT',value:'YES+cb',domain:'.youtube.com',path:'/'}]);
const page=await ctx.newPage();
await page.setViewportSize({width:1280,height:800});
await page.goto(`https://www.youtube.com/watch?v=${video}#${hash(modes[0])}`,{waitUntil:'domcontentloaded',timeout:45000});
await page.waitForSelector('#vtt-list .vtt-item, #vtt-lang-onboarding',{timeout:30000}).catch(()=>{});
await applyTheme(page);
if(extraClass) await page.evaluate(c=>document.documentElement.classList.add(c), extraClass);
if(THEME_CSS) console.log('theme: light (capture-only override injected)');
await sleep(2500);
// cover the player with our own clip
await page.evaluate((src)=>{
  const ensure=()=>{
    const p=document.querySelector('#movie_player'); if(!p) return;
    let v=document.getElementById('lg-bgvid');
    if(!v){ v=document.createElement('video'); v.id='lg-bgvid'; v.src=src;
      v.muted=true; v.loop=true; v.autoplay=true; v.setAttribute('playsinline','');
      v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1000;pointer-events:none;background:#000;visibility:visible!important;';}
    if(v.parentElement!==p) p.appendChild(v);
    if(v.paused) v.play().catch(()=>{});
    // Hide YouTube's own overlays inside the player (bot-wall / error screens):
    // they paint above our backdrop otherwise.
    // The bot-wall is #error-screen — a SIBLING of #movie_player inside #player
    // (verified by walking the DOM at the player's centre). Hide just that node;
    // #movie_player (which hosts our backdrop) stays.
    document.querySelectorAll('#error-screen, .ytp-error, .ytp-cued-thumbnail-overlay')
      .forEach(e=>{ if(!e.contains(v)) e.style.setProperty('display','none','important'); });
    // #movie_player must be visible and sized even though YT parked its <video> offscreen.
    p.style.setProperty('display','block','important');
    // YT flips the blocked player subtree to visibility:hidden — our backdrop
    // inherits it, so force both the player box and the video back to visible.
    p.style.setProperty('visibility','visible','important');
    v.style.setProperty('visibility','visible','important');
  };
  ensure(); if(!window.__lgBgTimer) window.__lgBgTimer=setInterval(ensure,1000);
}, BBB);
await sleep(2500);
// Re-fire demo mode now that the backdrop is attached & visible: updateOverlay()
// re-parents #vtt-video-overlay onto #movie_player, so the dual lines land on
// OUR footage rather than YT's offscreen (bot-walled) <video>.
await page.evaluate(a=>window.postMessage({__lingogram:'demo',state:{mode:'sidebar',learn:a.l,native:a.n}},'*'),{l:learn,n:native});
await sleep(1800);
// Set the theme through the panel's own control, then close settings again so
// the per-mode loop below starts from a known (panel-closed) state.
if(themePref){
  await page.evaluate(async(want)=>{
    const sidebar=document.getElementById('vtt-sidebar');
    if(!sidebar?.classList.contains('vtt-settings-open')) document.getElementById('vtt-settings-btn')?.click();
    await new Promise(r=>setTimeout(r,600));
    document.querySelector(`.vtt-seg-btn[data-value="${want}"]`)?.click();
    await new Promise(r=>setTimeout(r,600));
    document.getElementById('vtt-settings-btn')?.click();
  }, themePref);
  await sleep(1200);
  const applied=await page.evaluate(()=>document.documentElement.classList.contains('vtt-light'));
  console.log(`  theme pref: ${themePref} (vtt-light on <html>: ${applied})`);
}
const st=await page.evaluate(()=>{
  const v=document.getElementById('lg-bgvid');
  const o=document.getElementById('vtt-video-overlay');
  return {backdrop: v ? (v.paused?'attached (paused)':'playing') : 'MISSING',
          overlay: o ? 'on video' : 'MISSING'};
});
console.log('  backdrop:', st.backdrop, '| dual-subtitle overlay:', st.overlay);
if (st.backdrop==='MISSING') console.warn('  ! backdrop missing — shots will show the bot-wall');
for(let k=0;k<modes.length;k++){
  const m=modes[k];
  if(k>0){ await page.evaluate(s=>window.postMessage({__lingogram:'demo',state:s},'*'),{mode:demoModeFor(m),learn,native}); }
  await page.waitForFunction(mm=>(mm==='onboarding'?!!document.getElementById('vtt-lang-onboarding'):document.querySelectorAll('#vtt-list .vtt-item').length>3),demoModeFor(m),{timeout:8000}).catch(()=>{});
  // Open (or close) the settings panel to match the requested mode, so
  // sidebar/guess never inherit a panel a previous 'settings' shot left open.
  await page.evaluate((want)=>{
    const sidebar=document.getElementById('vtt-sidebar');
    const open=!!sidebar && sidebar.classList.contains('vtt-settings-open');
    if(want!==open) document.getElementById('vtt-settings-btn')?.click();
  }, m==='settings');
  if(m==='settings') await page.waitForFunction(
    ()=>document.getElementById('vtt-settings-panel')?.classList.contains('open'),
    null,{timeout:8000}).catch(()=>{});
  await sleep(1400);
  await page.screenshot({path:join(OUT,outFor(m)),type:'png',clip:{x:0,y:0,width:1280,height:800}});
  console.log('✓',outFor(m));
}
await ctx.close();
