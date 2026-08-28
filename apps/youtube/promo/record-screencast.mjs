// Record a LIVE promo screencast of the Lingogram YouTube extension — an actual
// browser session where a (synthetic) cursor moves over the panel and *uses* the
// tool: picks languages, watches dual subtitles light up, flips on Guess mode and
// reveals words. Not a slideshow of screenshots.
//
//   node record-screencast.mjs
//   node record-screencast.mjs --video kJQP7kiw5Fk --learn es --native en
//
// How the cursor is visible: Playwright's recordVideo captures page pixels but NOT
// the OS pointer, so we inject our own arrow + click ripples and drive them in
// lockstep with real page.mouse moves (so real :hover / click handlers still fire).
// The extension runs its built-in `#vtt-demo` mode (canned dual subs, no network),
// and we drive state changes through the same in-page hooks the screenshot tool uses.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..', 'build');
const ABP = join(HERE, 'vendor', 'adblock-plus');
const HAS_ABP = existsSync(join(ABP, 'manifest.json'));
const EXTS = HAS_ABP ? `${BUILD},${ABP}` : BUILD;
const OUT_DIR = join(HERE, 'video', 'out');
const RAW_DIR = join(OUT_DIR, 'raw');
mkdirSync(RAW_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };

// Host watch page (only needed for the player DOM the extension overlays). The
// VISIBLE backdrop is our own local Big Buck Bunny clip layered on top (see the
// <video> cover below) — a real, CC-BY, freely-reusable film, not the Despacito
// footage that drew a Content ID "Visual" claim. Override host with --video <id>.
const VIDEO = arg('video', 'aqz-KE-bpKQ');
const LEARN = arg('learn', 'es');
const NATIVE = arg('native', 'en');
const W = 1920, H = 1080;   // native 16:9 1080p (recordVideo captures at CSS-px = viewport)

const require = createRequire(import.meta.url);
const PW = '/Users/aliaksandrkarzhavin/workspace/chrome-extentions/Disable automatic tab discarding/node_modules/playwright/index.js';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = require(PW)); }

// Logo for the end card (inlined as a data URI — the page is youtube.com so it
// can't read file:// assets).
let LOGO_DATA = '';
try {
    // Always the CURRENT extension icon (the promo dir's icon128.png went stale
    // after the chameleon rebrand) — read it straight from the build.
    const p = join(BUILD, 'src', 'assets', 'icons', 'icon128.png');
    if (existsSync(p)) LOGO_DATA = 'data:image/png;base64,' + readFileSync(p).toString('base64');
} catch { /* end card just drops the logo */ }

// The local backdrop clip (Big Buck Bunny, CC-BY) — a real, copyright-free video
// we fully control (no ads, no YouTube playback errors, no third-party footage in
// the render). Served SAME-ORIGIN via request interception (below) so it isn't
// blocked as mixed content / by CSP on the YouTube page.
const CLIP = join(HERE, 'video', arg('clip', 'bbb-clip.mp4'));   // --clip <file in video/> overrides the backdrop
const BBB_SRC = 'https://www.youtube.com/__lingogram_backdrop.mp4';
// Self-heal: cut the small 720p backdrop clip (meadow scene, no audio) from the
// full Big Buck Bunny source the first time, so the repo needs only the source.
const CLIP_MOV = join(HERE, 'video', 'big_buck_bunny_1080p_h264.mov');
if (!existsSync(CLIP) && existsSync(CLIP_MOV)) {
    console.log('cutting backdrop clip from', CLIP_MOV);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '44', '-t', '70', '-i', CLIP_MOV,
        '-an', '-vf', 'scale=1920:1080', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', CLIP], { stdio: 'inherit' });
}

const ctx = await chromium.launchPersistentContext(`/tmp/lg-screencast`, {
    headless: false,
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    bypassCSP: true,
    // recordVideo captures at the CSS viewport size; with DSF 2 the page renders at
    // 2× and is supersampled down to a crisp native 1920×1080.
    recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
    args: [
        '--headless=new',
        `--disable-extensions-except=${EXTS}`,
        `--load-extension=${EXTS}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
        '--hide-scrollbars',
    ],
});
// Serve the backdrop clip from a youtube.com URL (same-origin → no mixed-content
// block); bypassCSP covers the CSP media-src rule.
await ctx.route(BBB_SRC, (route) => route.fulfill({ path: CLIP, contentType: 'video/mp4' }));

if (HAS_ABP) await sleep(2500);
let [sw] = ctx.serviceWorkers();
if (!sw) await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);

await ctx.addCookies([
    { name: 'SOCS', value: 'CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' },
    { name: 'CONSENT', value: 'YES+cb', domain: '.youtube.com', path: '/' },
]);

const page = await ctx.newPage();
const recStart = Date.now();                 // recording begins ~when the page is created
await page.setViewportSize({ width: W, height: H });

// Start on the onboarding picker so the story opens with "choose your languages".
const startUrl = `https://www.youtube.com/watch?v=${VIDEO}#vtt-demo-onboarding?learn=${LEARN}&native=${NATIVE}`;
await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#vtt-lang-onboarding', { timeout: 30000 }).catch(() => {});

const safe = async (fn, a) => { try { return await page.evaluate(fn, a); } catch { return null; } };
const playClean = () => safe(() => {
    const v = document.querySelector('video');
    if (v) { v.muted = true; if (v.paused) { try { v.play(); } catch {} } }
    const player = document.querySelector('#movie_player, .html5-video-player');
    const ad = !!player && player.classList.contains('ad-showing');
    if (ad) document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')?.click();
    return { promo: document.body.classList.contains('vtt-promo'), playing: v ? !v.paused && v.currentTime > 0.3 : false, ad };
});

// Get a clean, ad-free, playing frame BEFORE the choreography (this messy warm-up
// is trimmed off the front in ffmpeg).
let ok = false, reloads = 0;
for (let i = 0; i < 70; i++) {
    await sleep(700);
    const st = await playClean();
    if (st && st.promo && st.playing && !st.ad) { ok = true; break; }
    if (st && st.ad && (i === 12 || i === 28) && reloads < 2) {
        reloads++;
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForSelector('#vtt-lang-onboarding', { timeout: 30000 }).catch(() => {});
    }
}
console.log(ok ? '✓ clean playing frame' : '! proceeding without a confirmed clean frame');

// Cover the real YouTube player with our own <video> of the local CC-BY clip.
// It sits ABOVE the YT video (z 999) and BELOW the on-video subtitle overlay
// (z 1000), so the render shows our footage; the extension still drives its demo
// over the (now-hidden) real player. Re-attached/kept-playing on an interval.
await page.evaluate((src) => {
    const ensure = () => {
        const player = document.querySelector('#movie_player');
        if (!player) return;
        let v = document.getElementById('lg-bgvid');
        if (!v) {
            v = document.createElement('video');
            v.id = 'lg-bgvid';
            v.src = src;
            v.muted = true; v.loop = true; v.autoplay = true;
            v.setAttribute('playsinline', '');
            v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:999;pointer-events:none;background:#000;';
        }
        if (v.parentElement !== player) player.appendChild(v);
        if (v.paused) v.play().catch(() => {});
        // Bot-walled player: the wall is #error-screen — a SIBLING of
        // #movie_player inside #player — and YT flips the blocked subtree to
        // visibility:hidden. Hide the wall, force the player + backdrop visible
        // (same recipe as screenshots/capture-backdrop.mjs).
        document.querySelectorAll('#error-screen, .ytp-error, .ytp-cued-thumbnail-overlay')
            .forEach((e) => { if (!e.contains(v)) e.style.setProperty('display', 'none', 'important'); });
        player.style.setProperty('display', 'block', 'important');
        player.style.setProperty('visibility', 'visible', 'important');
        v.style.setProperty('visibility', 'visible', 'important');
        // Promo layout: with #secondary hidden (CSS below), YouTube's own flexy
        // sizing gives the player the freed width — just keep nudging it to
        // recompute. (Pinning px sizes loses a fight with YT's resize JS.)
        window.dispatchEvent(new Event('resize'));
        // Demo-mode's white .sk-below cover was anchored while the player was
        // still small — re-anchor it under the now-taller player each tick.
        const pr = player.getBoundingClientRect();
        document.querySelectorAll('#vtt-demo-noise .sk-below').forEach((e) => {
            e.style.top = Math.round(pr.bottom + 8) + 'px';
            e.style.left = '0px';
            e.style.width = Math.round(pr.right + 16) + 'px';
        });
    };
    ensure();
    if (!window.__lgBgTimer) window.__lgBgTimer = setInterval(ensure, 1000);
}, BBB_SRC);
await sleep(1200);   // let the backdrop clip buffer + start

// ── Inject the synthetic cursor + ripple + end card ────────────────────────
await page.evaluate(() => {
    const Z = 2147483647;
    const style = document.createElement('style');
    style.id = 'lg-cursor-style';
    style.textContent = `
      /* Promo layout: no related-videos rail — the player and the panel share
         the full frame. Sizes are pinned in px by the backdrop ensure() loop
         (YouTube's JS sizing fights pure-CSS overrides). */
      ytd-watch-flexy #secondary{display:none!important;}
      ytd-watch-flexy #primary{max-width:none!important;}
      /* demo-mode's own white skeleton column over the (now hidden) related
         rail — built from a stale #secondary rect, would cover the wide player */
      #vtt-demo-noise .sk-col{display:none!important;}
      tp-yt-iron-overlay-backdrop{display:none!important;}
      #lg-cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:${Z};
        pointer-events:none;will-change:transform;transform:translate(-100px,-100px);
        filter:drop-shadow(0 3px 5px rgba(0,0,0,.45));}
      #lg-cursor.press{transform-origin:6px 4px;}
      #lg-cursor svg{display:block;}
      /* Click feedback: a soft glow flash + an expanding ring that fade out,
         both centred exactly under the cursor tip. */
      /* z-index Z (== sidebar) + appended after it in the DOM, so the ring paints
         OVER the panel, not behind it. The cursor (on <html>) still sits on top. */
      .lg-click{position:fixed;left:0;top:0;z-index:${Z};pointer-events:none;
        transform:translate(var(--x),var(--y));}
      .lg-click i{position:absolute;display:block;border-radius:50%;}
      .lg-click .lg-glow{left:-15px;top:-15px;width:30px;height:30px;
        background:radial-gradient(circle,rgba(180,150,255,.6),rgba(124,92,255,0) 68%);
        animation:lg-glow .5s ease-out forwards;}
      .lg-click .lg-ring{left:-8px;top:-8px;width:16px;height:16px;
        border:2.5px solid rgba(150,120,255,.95);
        box-shadow:0 0 18px 2px rgba(124,92,255,.6),inset 0 0 6px rgba(124,92,255,.5);
        animation:lg-ring .6s cubic-bezier(.16,.73,.3,1) forwards;}
      @keyframes lg-ring{0%{transform:scale(.3);opacity:0;}16%{opacity:1;}100%{transform:scale(3.6);opacity:0;}}
      @keyframes lg-glow{0%{transform:scale(.4);opacity:.95;}100%{transform:scale(2.3);opacity:0;}}
      /* fill:both holds the end state (opacity:1) — a plain WAAPI fade can revert
         to opacity:0 and leave the dropdown invisible. */
      @keyframes lg-dd-in{from{opacity:0;transform:translateY(-7px) scale(.98);}to{opacity:1;transform:none;}}
      #lg-dd{animation:lg-dd-in .17s cubic-bezier(.2,.7,.3,1) both;}
      #lg-endcard{position:fixed;inset:0;z-index:${Z};pointer-events:none;display:flex;
        flex-direction:column;align-items:center;justify-content:center;gap:18px;opacity:0;
        transition:opacity .55s ease;
        background:radial-gradient(70% 80% at 50% 42%,rgba(38,28,86,.99),rgba(5,5,14,1));
        -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
      #lg-endcard.show{opacity:1;}
      #lg-endcard img{width:96px;height:96px;border-radius:22px;
        box-shadow:0 18px 60px rgba(124,92,255,.6);}
      #lg-endcard .lg-name{font:800 46px/1.05 "YouTube Sans",Roboto,Arial,sans-serif;
        letter-spacing:-1px;color:#fff;}
      #lg-endcard .lg-tag{font:500 21px/1.3 Roboto,Arial,sans-serif;color:#c9c4ef;}
      #lg-endcard .lg-name b{background:linear-gradient(90deg,#a78bfa,#22d3ee);
        -webkit-background-clip:text;background-clip:text;color:transparent;}
    `;
    document.documentElement.appendChild(style);

    const SVGNS = 'http://www.w3.org/2000/svg';
    const cur = document.createElement('div');
    cur.id = 'lg-cursor';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '30'); svg.setAttribute('height', '30');
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', 'M5 2.5 L5 21 L10 16.2 L13.2 22.5 L16 21 L12.8 14.8 L19.5 14.8 Z');
    path.setAttribute('fill', '#fff');
    path.setAttribute('stroke', '#1a1530');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path); cur.appendChild(svg);
    document.documentElement.appendChild(cur);

    const card = document.createElement('div');
    card.id = 'lg-endcard';
    const name = document.createElement('div');
    name.className = 'lg-name';
    name.appendChild(document.createTextNode('Lingo'));
    const b = document.createElement('b'); b.textContent = 'gram'; name.appendChild(b);
    const tag = document.createElement('div');
    tag.className = 'lg-tag';
    tag.textContent = 'learn a language while you watch YouTube';
    card.appendChild(name); card.appendChild(tag);
    document.documentElement.appendChild(card);

    window.__lg = {
        move(x, y, ms) {
            // Offset so the arrow's TIP (≈6,3 px into the glyph) lands on (x,y) —
            // the same point page.mouse clicks and where the ripple is centred.
            const c = document.getElementById('lg-cursor');
            c.style.transition = `transform ${ms}ms cubic-bezier(.22,.7,.3,1)`;
            c.style.transform = `translate(${x - 6}px,${y - 3}px)`;
        },
        ripple(x, y) {
            const c = document.getElementById('lg-cursor');
            c.classList.add('press');
            const base = c.style.transform;
            c.animate([{ transform: base + ' scale(1)' },
                       { transform: base + ' scale(.8)' },
                       { transform: base + ' scale(1)' }],
                      { duration: 240, easing: 'ease-out' });
            const w = document.createElement('div');
            w.className = 'lg-click';
            w.style.setProperty('--x', x + 'px');
            w.style.setProperty('--y', y + 'px');
            const glow = document.createElement('i'); glow.className = 'lg-glow';
            const ring = document.createElement('i'); ring.className = 'lg-ring';
            w.appendChild(glow); w.appendChild(ring);
            document.body.appendChild(w);
            setTimeout(() => w.remove(), 680);
        },
        endcard(on) { document.getElementById('lg-endcard').classList.toggle('show', on); },
        // Walk the active line (and the on-video overlay) through `order` on a
        // timer, so the subtitles visibly switch as the video plays. Demo mode has
        // no timeupdate loop, so we drive the highlight + overlay text directly
        // from the rendered list rows (works for any language pair).
        play(order, stepMs) {
            const list = document.getElementById('vtt-list');
            let k = 0;
            const apply = () => {
                const i = order[k];
                document.querySelectorAll('#vtt-list .vtt-item').forEach((it) => it.classList.remove('active-sub'));
                const item = document.querySelector(`#vtt-list .vtt-item[data-index="${i}"]`);
                if (!item) return;
                item.classList.add('active-sub');
                if (list) {
                    const lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
                    list.scrollBy({ top: (ir.top - lr.top) - (list.clientHeight - ir.height) / 2, behavior: 'smooth' });
                }
                const ov = document.getElementById('vtt-video-overlay');
                if (ov) {
                    const m = ov.querySelector('.vtt-overlay-main'), s = ov.querySelector('.vtt-overlay-sub');
                    const mt = item.querySelector('.vtt-main-text'), st = item.querySelector('.vtt-sub-text');
                    if (m && mt) m.textContent = mt.textContent;
                    if (s && st) s.textContent = st.textContent;
                }
            };
            this.stopPlay();
            apply();
            window.__lgTimer = setInterval(() => {
                if (++k >= order.length) { this.stopPlay(); return; }
                apply();
            }, stepMs);
        },
        stopPlay() { if (window.__lgTimer) { clearInterval(window.__lgTimer); window.__lgTimer = null; } },
    };
}, );
// hand the logo over (separate eval keeps the inline string small)
await page.evaluate((logo) => { window.__LG_LOGO = logo; const c = document.getElementById('lg-endcard'); if (logo && c && !c.querySelector('img')) { const i = document.createElement('img'); i.src = logo; c.prepend(i); } }, LOGO_DATA);

// ── Node-side cursor driver (visible cursor + real mouse in lockstep) ───────
let curX = W / 2, curY = H + 40;
const setDemo = (mode) => safe((s) => window.postMessage({ __lingogram: 'demo', state: s }, '*'),
    { mode, learn: LEARN, native: NATIVE });

async function glide(x, y, ms = 850) {
    await page.evaluate(({ x, y, ms }) => window.__lg.move(x, y, ms), { x, y, ms });
    await sleep(ms);                       // let the visible cursor travel
    await page.mouse.move(x, y, { steps: 6 }); // land the real pointer → triggers :hover
    curX = x; curY = y;
    await sleep(60);
}
async function clickHere() {
    await page.evaluate(({ x, y }) => window.__lg.ripple(x, y), { x: curX, y: curY });
    await page.mouse.click(curX, curY);
    await sleep(120);
}
async function tapVisualOnly() {                 // ripple without a real click (e.g. native <select>)
    await page.evaluate(({ x, y }) => window.__lg.ripple(x, y), { x: curX, y: curY });
    await sleep(120);
}
async function center(sel, nth = 0) {
    const r = await page.evaluate(({ sel, nth }) => {
        const el = document.querySelectorAll(sel)[nth];
        if (!el) return null;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return null;
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, { sel, nth });
    return r;
}
async function glideTo(sel, { nth = 0, ms = 850, dx = 0, dy = 0 } = {}) {
    const c = await center(sel, nth);
    if (!c) { console.log('  (no target) ' + sel); return false; }
    await glide(Math.round(c.x + dx), Math.round(c.y + dy), ms);
    return true;
}
const baseCode = (c) => (c || '').split(/[-_]/)[0].toLowerCase();

// Native <select> popups aren't painted into Playwright's recording, so fake one:
// a themed dropdown under the picker with a window of real options, the chosen
// language highlighted. Returns the target row's centre so the cursor can land on
// it. Purely cosmetic — the select already shows the right value.
async function openSelectDropdown(sel, nth, targetCode) {
    return page.evaluate(({ sel, nth, targetCode }) => {
        const el = document.querySelectorAll(sel)[nth];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        document.getElementById('lg-dd')?.remove();
        const opts = Array.from(el.options).filter((o) => o.value);   // drop the "Select…" placeholder
        let ti = opts.findIndex((o) => o.value === targetCode);
        if (ti < 0) ti = 0;
        const start = Math.max(0, Math.min(ti - 2, opts.length - 6));
        const win = opts.slice(start, start + 6);
        const dd = document.createElement('div');
        dd.id = 'lg-dd';
        dd.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 5}px;width:${r.width}px;opacity:1;
            background:#1f1f1f;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px;
            box-shadow:0 22px 48px rgba(0,0,0,.6),0 0 0 1px rgba(124,92,255,.3);
            z-index:2147483647;overflow:hidden;font:13px Roboto,Arial,sans-serif;`;
        let target = null;
        win.forEach((o) => {
            const row = document.createElement('div');
            row.textContent = o.textContent;
            const hit = o.value === targetCode;
            row.style.cssText = `padding:8px 10px;border-radius:6px;color:#f3f4f6;white-space:nowrap;` +
                (hit ? 'background:linear-gradient(90deg,rgba(124,92,255,.55),rgba(77,163,255,.35));color:#fff;font-weight:600;' : '');
            dd.appendChild(row);
            if (hit) target = row;
        });
        document.body.appendChild(dd);   // CSS #lg-dd animation handles the fade-in
        const tr = (target ?? dd.firstChild).getBoundingClientRect();
        return { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
    }, { sel, nth, targetCode });
}
async function closeDropdown() {
    await page.evaluate(() => {
        const d = document.getElementById('lg-dd');
        if (!d) return;
        d.style.animation = 'none';   // release the fill:both hold on opacity
        d.style.transition = 'opacity .15s ease-in, transform .15s ease-in';
        d.style.opacity = '0';
        d.style.transform = 'translateY(-4px)';
        setTimeout(() => d.remove(), 170);
    });
    await sleep(180);
}
// Scroll the list so line `index` sits `marginTop` px below the list's top edge —
// the extension's own auto-scroll is skipped while the (real) pointer hovers the
// sidebar, so a revealed line can otherwise hide under the header.
async function scrollLineIntoView(index, marginTop = 64) {
    await page.evaluate(({ index, marginTop }) => {
        const list = document.getElementById('vtt-list');
        const item = document.querySelector(`#vtt-list .vtt-item[data-index="${index}"]`);
        if (!list || !item) return;
        const lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
        list.scrollBy({ top: (ir.top - lr.top) - marginTop, behavior: 'smooth' });
    }, { index, marginTop });
    await sleep(520);
}
// Mirror a guess line's current reveal state (revealed words + masks, and the
// translation once fully revealed) into the on-video overlay, so the overlay
// un-masks word-by-word in step with the clicks — clicking the line itself only
// updates the panel.
async function syncOverlay(index) {
    await page.evaluate(({ index }) => {
        const item = document.querySelector(`#vtt-list .vtt-item[data-index="${index}"]`);
        const ov = document.getElementById('vtt-video-overlay');
        if (!item || !ov) return;
        ov.style.display = 'flex';
        const src = item.querySelector('.vtt-main-text');
        let dst = ov.querySelector('.vtt-overlay-main');
        if (!dst) { dst = document.createElement('div'); dst.className = 'vtt-overlay-main'; dst.dataset.index = String(index); ov.insertBefore(dst, ov.firstChild); }
        if (src && dst) {
            dst.textContent = '';
            Array.from(src.childNodes).forEach((n) => dst.appendChild(n.cloneNode(true)));
        }
        const sub = item.querySelector('.vtt-sub-text');
        let ovSub = ov.querySelector('.vtt-overlay-sub');
        if (item.classList.contains('fully-revealed') && sub) {
            if (!ovSub) { ovSub = document.createElement('div'); ovSub.className = 'vtt-overlay-sub'; ov.appendChild(ovSub); }
            ovSub.textContent = sub.textContent;
        }
    }, { index });
}
// Set the active-line highlight directly (the real video time isn't aligned to the
// demo's 0–27s subtitle clock, so highlightSubtitle resolves to "no active line").
async function setActiveLine(index) {
    await page.evaluate(({ index }) => {
        document.querySelectorAll('#vtt-list .vtt-item').forEach((it) => it.classList.remove('active-sub'));
        document.querySelector(`#vtt-list .vtt-item[data-index="${index}"]`)?.classList.add('active-sub');
    }, { index });
}
// Reveal the next masked word in a guess line WITHOUT the extension's click
// handler (which would seekVideo() the backdrop to the intro). Once every word
// shows, mark it fully-revealed and drop in the translation row.
async function revealNextWordManual(lineIndex, translation) {
    await page.evaluate(({ lineIndex, translation }) => {
        const item = document.querySelector(`#vtt-list .vtt-item[data-index="${lineIndex}"]`);
        const main = item && item.querySelector('.vtt-main-text');
        if (!main) return;
        const masked = main.querySelector('span.vtt-masked-word');
        if (masked) {
            // PR #31 parks the real word in data-hidden while masked (data-word
            // only exists once revealed) — mirror the extension's own reveal.
            const word = masked.dataset.hidden || masked.dataset.word;
            if (word) {
                masked.textContent = word;
                masked.dataset.word = word;
                delete masked.dataset.hidden;
            }
            masked.className = 'vtt-revealed-word';
        }
        if (!main.querySelector('span.vtt-masked-word')) {
            item.classList.add('fully-revealed');
            if (!item.querySelector('.vtt-sub-text') && translation) {
                const sub = document.createElement('div');
                sub.className = 'vtt-sub-text';
                sub.textContent = translation;
                item.appendChild(sub);
            }
        }
    }, { lineIndex, translation });
}
// Drag-select a word in a subtitle line (real selection → the extension's own
// "+ Lingogram" quick-add pill pops up). The synthetic cursor sweeps the word as
// the real mouse drags it.
async function dragSelectWord(lineIndex, wordText) {
    const box = await page.evaluate(({ lineIndex, wordText }) => {
        const item = document.querySelector(`#vtt-list .vtt-item[data-index="${lineIndex}"]`);
        if (!item) return null;
        const span = Array.from(item.querySelectorAll('.vtt-main-text span[data-word]'))
            .find((s) => (s.dataset.word || '').toLowerCase() === wordText.toLowerCase());
        if (!span) return null;
        const r = span.getBoundingClientRect();
        return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 };
    }, { lineIndex, wordText });
    if (!box) { console.log('  (no word) ' + wordText); return false; }
    await glide(Math.round(box.x1), Math.round(box.y), 600);
    await page.mouse.down();
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
        const x = box.x1 + (box.x2 - box.x1) * (i / steps);
        await page.evaluate(({ x, y }) => window.__lg.move(x, y, 0), { x, y: box.y });
        await page.mouse.move(x, box.y);
        await sleep(20);
    }
    await page.mouse.up();
    curX = Math.round(box.x2); curY = Math.round(box.y);
    return true;
}
// Confirm the save (ADD_WORD needs sign-in, so in demo we apply the same visible
// outcome the real flow produces): tag the word saved, bump the chip counter, and
// pop a success toast.
async function confirmSaveWord(lineIndex, wordText) {
    await page.evaluate(({ lineIndex, wordText }) => {
        document.getElementById('lingogram-quick-add-pill')?.remove();
        const item = document.querySelector(`#vtt-list .vtt-item[data-index="${lineIndex}"]`);
        const span = item && Array.from(item.querySelectorAll('.vtt-main-text span[data-word]'))
            .find((s) => (s.dataset.word || '').toLowerCase() === wordText.toLowerCase());
        if (span) {
            span.classList.add('vtt-saved-word');
            if (!(span.nextElementSibling && span.nextElementSibling.classList.contains('vtt-saved-badge'))) {
                const badge = document.createElement('span');
                badge.className = 'vtt-saved-badge';
                badge.textContent = '✓ saved';
                span.insertAdjacentElement('afterend', badge);
            }
        }
        window.getSelection()?.removeAllRanges();
        document.querySelectorAll('#vtt-sidebar *').forEach((e) => {
            if (e.children.length === 0 && /\b142\b/.test(e.textContent || '')) e.textContent = (e.textContent || '').replace('142', '143');
        });
        document.getElementById('lingogram-quick-add-toast')?.remove();
        const t = document.createElement('div');
        t.id = 'lingogram-quick-add-toast';
        t.textContent = '✓ Added to Lingogram — ' + wordText;
        Object.assign(t.style, {
            position: 'fixed', left: '32%', bottom: '70px', transform: 'translateX(-50%)',
            zIndex: '2147483647', padding: '11px 18px', borderRadius: '11px',
            background: 'linear-gradient(90deg,#16a34a,#15803d)', color: '#fff',
            fontSize: '15px', fontWeight: '700', whiteSpace: 'nowrap',
            fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            boxShadow: '0 12px 34px rgba(0,0,0,.45)',
        });
        document.body.appendChild(t);
        t.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(10px)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0)' }],
            { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' });
        setTimeout(() => t.remove(), 2900);
    }, { lineIndex, wordText });
}

// ═══════════════════════ CHOREOGRAPHY ═══════════════════════
const perfStart = Date.now();
console.log('▶ choreography start @', ((perfStart - recStart) / 1000).toFixed(2) + 's');

// 0) cursor drifts in from the lower edge
await glide(W * 0.52, H * 0.46, 700);
await sleep(500);

// 1) Onboarding — "choose your languages": open each picker like a real dropdown
//    and click the language (the list drops down, the choice highlights).
await glideTo('#vtt-lang-onboarding select', { nth: 0, ms: 820 });
await tapVisualOnly();
const ddL = await openSelectDropdown('#vtt-lang-onboarding select', 0, baseCode(LEARN));
await sleep(480);
if (ddL) { await glide(Math.round(ddL.x), Math.round(ddL.y), 580); await tapVisualOnly(); }
await sleep(250);
await closeDropdown();
await sleep(360);

await glideTo('#vtt-lang-onboarding select', { nth: 1, ms: 700 });
await tapVisualOnly();
const ddN = await openSelectDropdown('#vtt-lang-onboarding select', 1, baseCode(NATIVE));
await sleep(480);
if (ddN) { await glide(Math.round(ddN.x), Math.round(ddN.y), 540); await tapVisualOnly(); }
await sleep(250);
await closeDropdown();
await sleep(450);

// 2) Languages chosen → dual subtitles populate (the payoff)
await setDemo('sidebar');
await glide(W * 0.86, H * 0.30, 900);          // drift up toward the panel as it fills
await sleep(1700);                              // let decorate() settle (saved word, overlay)

// 3) Rest on the active line + the saved word (✓ saved)
await glideTo('#vtt-list .vtt-item.active-sub .vtt-main-text span', { nth: 1, ms: 900 });
await sleep(800);
const savedC = await center('#vtt-list .vtt-saved-word', 0);
if (savedC) { await glide(Math.round(savedC.x), Math.round(savedC.y), 560); await sleep(1000); }

// 4) Let the video play: the subtitles auto-advance line by line — in the panel
//    AND on the on-video overlay. The cursor just drifts; the video drives it.
await page.evaluate(({ order, step }) => window.__lg.play(order, step), { order: [1, 2, 3, 4, 5], step: 1550 });
await glideTo('#vtt-video-overlay', { ms: 1000, dy: -6 });
await sleep(1500);                              // watch a couple switch on the video
await glide(W * 0.66, H * 0.34, 850);
await sleep(1500);                              // and a couple more in the panel
await glideTo('#vtt-video-overlay', { ms: 850, dy: -6 });
await sleep(1400);
await page.evaluate(() => window.__lg.stopPlay());

// 5) Flip on Guess mode the way a real user does: one click on the Guess chip
//    in the panel's quick-modes bar (no settings detour).
// Grab line 1's translation while it's still in the dual list (guess mode rebuilds
// the rows without it) — used when the manual reveal finishes.
const line1Sub = await page.evaluate(() => document.querySelector('#vtt-list .vtt-item[data-index="1"] .vtt-sub-text')?.textContent || '');

await glideTo('#vtt-qm-guess', { ms: 950 });
await clickHere();
await sleep(700);
await setActiveLine(1);     // restore the line-1 highlight + refill the overlay
await syncOverlay(1);       // (highlightSubtitle saw real video time → cleared them)
await sleep(350);
await scrollLineIntoView(1, 70);

// 6) Reveal the line word-by-word by clicking the masked words ON THE VIDEO
//    OVERLAY (the product's own reveal affordance). The panel un-masks in sync.
const overlayMaskCenter = () => page.evaluate(() => {
    const s = document.querySelector('#vtt-video-overlay .vtt-masked-word');
    if (!s) return null;
    const b = s.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
for (let i = 0; i < 7; i++) {
    const c = await overlayMaskCenter();
    if (!c) break;
    await glide(Math.round(c.x), Math.round(c.y), i === 0 ? 900 : 420);
    await sleep(160);
    await tapVisualOnly();
    await revealNextWordManual(1, line1Sub);
    await syncOverlay(1);
    await sleep(470);
}
await sleep(900);

// 9) Select a word from that line and add it to Lingogram — drag-select raises
//    the real "+ Lingogram" pill; clicking it saves the word (✓ saved + toast).
const SAVE_WORD = 'aprender';
if (await dragSelectWord(1, SAVE_WORD)) {
    await sleep(600);                                   // the "+ Lingogram" pill pops up
    const pillC = await center('#lingogram-quick-add-pill', 0);
    if (pillC) { await glide(Math.round(pillC.x), Math.round(pillC.y), 680); await sleep(280); await tapVisualOnly(); }
    await sleep(140);
    await confirmSaveWord(1, SAVE_WORD);               // ✓ saved highlight + counter + toast
    await sleep(1900);
}

// 10) Settle on the beauty shot, then the end card
await glide(W * 0.58, H * 0.5, 850);
await sleep(900);
await page.evaluate(() => window.__lg.endcard(true));
await sleep(2400);

const perfEnd = Date.now();
console.log('■ choreography end   @', ((perfEnd - recStart) / 1000).toFixed(2) + 's');

const videoObj = page.video();
await ctx.close();                              // flushes the .webm
const rawPath = videoObj ? await videoObj.path() : null;
console.log('raw webm:', rawPath);

// ── Trim the warm-up + encode a clean mp4 ──────────────────────────────────
const trimStart = Math.max(0, (perfStart - recStart) / 1000 - 0.25);
const dur = (perfEnd - perfStart) / 1000 + 0.55;
const outMp4 = join(OUT_DIR, 'lingogram-live-demo.mp4');
const fade = Math.max(0, dur - 0.6).toFixed(2);
// Native 16:9 1080p — just trim, frame-rate, fades, high-quality H.264 for YouTube.
const vf = `fps=30,scale=${W}:${H}:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=${fade}:d=0.5,format=yuv420p`;
const ff = [
    '-y', '-ss', trimStart.toFixed(2), '-i', rawPath, '-t', dur.toFixed(2),
    '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=60', '-movflags', '+faststart', outMp4,
];
console.log('ffmpeg trim:', trimStart.toFixed(2), 'dur:', dur.toFixed(2));
const r = spawnSync('ffmpeg', ff, { stdio: 'inherit' });
if (r.status === 0) console.log('\n✓ wrote', outMp4);
else console.log('\n! ffmpeg failed', r.status);

// Open on the polished store hero for the first ~1s, then crossfade into the live
// demo — a stronger hook than the bare onboarding frame. Prefer the 2× source
// (shots/store-i18n@5/en/slide1.png) so the intro is crisp; fall back to the 1×
// store shot. Both live under the store-i18n pipeline's own subtree.
const introImg = existsSync(join(HERE, 'shots', 'store-i18n@5', 'en', 'slide1.png'))
    ? join(HERE, 'shots', 'store-i18n@5', 'en', 'slide1.png')
    : join(HERE, 'out', 'store-i18n@5', 'en', 'screenshot-1.png');
if (r.status === 0 && existsSync(introImg)) {
    const tmp = join(OUT_DIR, 'lingogram-live-demo.intro.mp4');
    // The hero is 16:10; frame it (fit to height) over a blurred-cover copy so it
    // fills the 16:9 intro, then crossfade into the demo.
    const fc2 = `[1:v]split=2[hb][hf];`
        + `[hb]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12[hbg];`
        + `[hf]scale=-2:${H}:flags=lanczos[hfg];`
        + `[hbg][hfg]overlay=(W-w)/2:0,format=yuva420p,fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st=0.85:d=0.3:alpha=1[ss];`
        + `[0:v][ss]overlay=0:0:enable='lte(t,1.15)'[v]`;
    const ff2 = [
        '-y', '-i', outMp4, '-loop', '1', '-t', '2', '-i', introImg,
        '-filter_complex', fc2, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
        '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=60', '-movflags', '+faststart', '-r', '30', tmp,
    ];
    const r2 = spawnSync('ffmpeg', ff2, { stdio: 'inherit' });
    if (r2.status === 0) { renameSync(tmp, outMp4); console.log('✓ added screenshot intro'); }
    else console.log('! intro overlay failed', r2.status);
}
