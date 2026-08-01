// Films the live demo into animated WebP stills for phones.
//
//   npm run build && node scripts/prep-mobile-shots.mjs [--tabs=dual,guess] [--langs=en,ru]
//
// On phones the site doesn't mount the live embed (a YouTube iframe plus the
// full extension UI is the heaviest block on the page and a 320px sidebar
// can't be "tried" on a 390px touch screen anyway — see src/demo/index.ts).
// Instead the demo frame shows an ANIMATED still of the real product.
//
// One animation per mode-slider tab — dual / guess / single (On-screen) /
// save (Dictionary) — so the tab the visitor reads about is the story the
// card above is playing. Developed on `en` first, then rolled out to all
// locales (--langs with no flag = every track language).
//
// How: serves build/, mounts the real demo in headless Chromium (the demo
// itself picks the visitor's language pair — same code path as production),
// PAUSES the video so the film is a static backdrop (the accent is the
// functionality, and identical background pixels across frames is what keeps
// the files small), then walks the UI through the story's beats capturing a
// keyframe per state. A white tap-ring is injected before each click. Frames
// join into one animated WebP; the story's payoff frame doubles as the
// prefers-reduced-motion fallback.
//
// Outputs (COMMITTED, so `npm run build` needs no image tooling):
//   src/assets/shots/<tab>-<lang>.webp         the animated story
//   src/assets/shots/<tab>-static-<lang>.webp  payoff frame, reduced motion
//   src/data/shot-locales.json                 languages with a full tab set
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.resolve(HERE, '../build');
const OUT_DIR = path.resolve(HERE, '../src/assets/shots');
const LOCALES_JSON = path.resolve(HERE, '../src/data/shot-locales.json');
const WIDTH = 1280;          // output width; capture is 2× and downscaled
const FREEZE_AT = 8.2;       // "This is a never-before-seen look." is active
const PORT = 4399;

if (!fs.existsSync(path.join(BUILD, 'demo.js'))) {
  console.error('build/ is stale or missing — run `npm run build` first');
  process.exit(1);
}

// ---------------------------------------------------------------- stories
// Each story is the beats of ONE slider tab, told with the real controls.
// `t.shoot(hold)` captures the current state as a frame shown for `hold` ms;
// `t.tap(sel, hold)` shows a tap-ring frame over the target, then clicks it.
// `payoff` marks which frame stands for the story when motion is disabled.
// `start` is the keyframe the ENCODED loop opens on: stories are FILMED in
// narrative order — setup, gesture, payoff — but a visitor taps a tab to see
// the feature, not the preamble, so the loop is rotated to open on the
// feature state. The setup beats still play, just later in the loop, which
// closes seamlessly either way.
const STORIES = {
  // Dual: the mode is a toggle on the quick-mode bar. One language → tap →
  // both languages everywhere (every transcript row + the yellow line on the
  // film) → tap shows it's reversible, and the loop lands back on one.
  dual: {
    payoff: 2,
    start: 2,   // open on both languages at once
    run: async (t) => {
      await t.click('#vtt-qm-dual');       // the demo opens in dual; start single
      await t.settle();
      await t.shoot(1800);                 // one language only
      await t.tap('#vtt-qm-dual', 420);
      await t.settle();
      await t.shoot(1000);                 // the payoff: both languages, at
                                           // once — a short hold, the loop
                                           // OPENS here and moves on fast
      await t.tap('#vtt-qm-dual', 420);    // …and it's one tap to undo — the
    },                                     // loop closes on the single state
  },
  // Guess: the line hides until you click it. The taps land on the caption
  // in the middle of the film — the biggest text on a phone screen — and the
  // sidebar row reveals in step (the product mirrors them). Two taps each
  // uncover a word, then the rest of the line comes out and the translation
  // pays off right on the film. The loop dissolves from the revealed line
  // back to the masked one: hidden → earned, again and again.
  guess: {
    payoff: 8,
    start: 2,   // open on the masked transcript
    run: async (t) => {
      const CAP = '#vtt-video-overlay .vtt-overlay-main';
      await t.shoot(1500);                 // dual, captions on the film
      await t.tap('#vtt-qm-guess', 550);   // enter guess mode from its chip,
      await t.settle();                    // the same doorway the dual story uses
      await t.shoot(900);                  // caption and transcript masked — a
                                           // short beat: the masked state stays
                                           // on screen through the ring frame
                                           // anyway, and the loop OPENS here,
                                           // so the first tap lands fast
      await t.tap(CAP, 550, 0.72);         // first tap (ring right of the text)…
      await t.settle();
      await t.shoot(900);                  // …one word
      await t.tap(CAP, 550, 0.72);         // second tap…
      await t.settle();
      await t.shoot(900);                  // …another
      await t.tap(CAP, 550, 0.72);         // last tap: finish the line — click
      await t.revealRest(CAP);             // through the remaining words…
      await t.settle();
      await t.shoot(3400);                 // …and the translation pays off
    },
  },
  // On-screen: not a mode but the overlay toggle — captions living on the
  // film itself. Same shape as the dual story: start with the film clean,
  // one tap puts both languages onto the video, one more takes them away.
  // The transcript stays dual throughout: the sidebar is untouched, only
  // where you read changes.
  single: {
    payoff: 2,
    start: 2,   // open on captions on the film
    run: async (t) => {
      await t.click('#vtt-qm-overlay');    // the demo opens with captions on
      await t.settle();                    // the film; start with it clean
      await t.shoot(1800);                 // film bare, transcript in the panel
      await t.tap('#vtt-qm-overlay', 420);
      await t.settle();
      await t.shoot(1000);                 // payoff: dual captions on the film
                                           // — a short hold, the loop OPENS
                                           // here and moves on fast
      await t.tap('#vtt-qm-overlay', 420); // one tap to clear them — the loop
    },                                     // closes on the bare film
  },
  // Dictionary: the save flow — select a word anywhere a subtitle lives and
  // the "+ Lingogram" pill offers to keep it. Told on the film's own caption,
  // where the text is big enough to read on a phone: gesture on the word →
  // selection + pill → tap the pill → the word highlights, earns its
  // "✓ saved" chip and the toast confirms. The loop dissolves the saved line
  // back to the untouched one: any word, any time.
  save: {
    payoff: 4,
    start: 2,   // open on the selected word + pill
    run: async (t) => {
      const WORD = '#vtt-video-overlay .vtt-overlay-main span[data-word="before-seen"]';
      await t.shoot(1500);                 // dual captions on the film
      await t.ring(WORD, 550);             // the gesture lands on one word…
      await t.select(WORD);                // …drag-select it for real
      await t.settle();
      await t.shoot(900);                  // selected, the pill offers to save
                                           // — a short beat, the loop OPENS
                                           // here and the save lands fast
      await t.tap('#lingogram-quick-add-pill', 550);
      await t.settle();
      // The toast anchors to the viewport's corner, which lies outside the
      // captured card — carry it into the stage so the confirmation is part
      // of the story. Same element, same text, only the anchor moves.
      await t.page.waitForSelector('#lingogram-quick-add-toast', { timeout: 5000 });
      await t.page.evaluate(() => {
        const toast = document.getElementById('lingogram-quick-add-toast');
        const stage = document.querySelector('.lge-stage').getBoundingClientRect();
        toast.style.right = 'auto';
        toast.style.bottom = 'auto';
        toast.style.left = `${stage.right - toast.getBoundingClientRect().width - 28}px`;
        toast.style.top = `${stage.top + 24}px`;
      });
      await t.shoot(3400);                 // payoff: highlighted word, ✓ saved
    },                                     // chip, "Added: before-seen" toast
  },
};

// ---------------------------------------------------------------- plumbing
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1].split(',').filter(Boolean) : null;
};
const demoSubs = JSON.parse(fs.readFileSync(path.resolve(HERE, '../src/data/demo-subs.json'), 'utf8'));
const ALL_LANGS = demoSubs.tracks.map((tr) => tr.lang);
const langs = argOf('langs') ?? ALL_LANGS;
const tabs = argOf('tabs') ?? Object.keys(STORIES);
for (const tab of tabs) if (!STORIES[tab]) { console.error(`unknown tab "${tab}"`); process.exit(1); }
// BCP-47 tags Chromium accepts where the bare code differs.
const LOCALE_TAG = { en: 'en-US', zh: 'zh-CN', pt: 'pt-BR' };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = path.join(BUILD, decodeURIComponent(req.url.split('?')[0]));
  if (!path.extname(p)) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(PORT, r));

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

for (const lang of langs) {
  const ctx = await browser.newContext({
    locale: LOCALE_TAG[lang] ?? lang,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // The YouTube iframe is nondeterministic in headless runs; aborting it
  // triggers the file fallback, which plays the same NASA clip.
  await page.route('**/*youtube*/**', (r) => r.abort());

  // Pause is not a one-shot: the <video> mounts with autoplay, and the play
  // promise that resolves after metadata loads will override a pause issued
  // too early. Pause, verify it HELD, retry until it does.
  const freeze = async () => {
    await page.waitForFunction(() => {
      const v = document.querySelector('.lge-video');
      return !!v && v.readyState >= 2 && v.duration > 60;
    }, undefined, { timeout: 20000 });
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.evaluate((t) => {
        const v = document.querySelector('.lge-video');
        v.pause();
        if (Math.abs(v.currentTime - t) > 0.4) v.currentTime = t;
      }, FREEZE_AT);
      await page.waitForTimeout(300);
      const held = await page.evaluate((t) => {
        const v = document.querySelector('.lge-video');
        return v.paused && !v.seeking && Math.abs(v.currentTime - t) <= 0.4;
      }, FREEZE_AT);
      if (held) return;
    }
    throw new Error('could not freeze the demo video');
  };

  // Every story starts from a fresh page: stories mutate sticky state (mode,
  // revealed guess words), and leaking one story's ending into the next's
  // opening frame would depend on run order.
  const prepare = async () => {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lge-video', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#vtt-list .vtt-item').length > 3, undefined, { timeout: 20000 });
    await freeze();
    await page.waitForTimeout(500);
    // Lock the grid so a collapsing panel slides off through the card's
    // overflow instead of reflowing the stage (a stage that grows between
    // frames would change the capture size and make the film jump).
    await page.evaluate(() => {
      document.querySelector('.lingogram-embed').style.gridTemplateColumns = '1fr 320px';
    });
  };

  const target = page.locator('#demo-embed');

  for (const tab of tabs) {
    await prepare();
    const frames = [];
    const delays = [];
    const t = {
      click: (sel) => page.click(sel),
      settle: () => page.waitForTimeout(400),
      shoot: async (holdMs) => {
        // Anything that resumed playback (a row click seeks and plays by
        // design) must not leak a moving backdrop into a frame.
        const moved = await page.evaluate((ft) => {
          const v = document.querySelector('.lge-video');
          return !v.paused || Math.abs(v.currentTime - ft) > 0.4;
        }, FREEZE_AT);
        if (moved) {
          await freeze();
          await page.waitForTimeout(300);
        }
        // Neutralize capture-only artifacts: the cursor parked over the last
        // clicked control bakes its hover tooltip into every frame, and a
        // mode switch re-renders the list with the active row scrolled out
        // of sight — park the mouse off the card and keep the row in view.
        await page.mouse.move(30, 950);
        await page.evaluate(() => {
          // A row click resumes playback briefly; the idle timer then hides
          // the player bar and a JS pause never un-hides it. Keep the bar in
          // every frame — a player that loses its controls mid-story reads
          // as a glitch.
          document.querySelector('.lge-stage')?.classList.remove('is-idle');
        });
        await page.waitForTimeout(250);
        // LAST, right before the capture: the sidebar's own auto-scroll pins
        // the active row to the top of the list on every re-render, and any
        // earlier correction gets overridden. One row of context above the
        // active one keeps the story from looking cramped.
        await page.evaluate(() => {
          const list = document.getElementById('vtt-list');
          const act = list?.querySelector('.vtt-item.active-sub');
          if (list && act) {
            const delta = act.getBoundingClientRect().top - list.getBoundingClientRect().top;
            list.scrollTop = Math.max(0, list.scrollTop + delta - 96);
          }
        });
        frames.push(await target.screenshot());
        delays.push(holdMs);
      },
      // The tap ring: shown in its own short frame before the click, so the
      // viewer sees WHERE the next change comes from. Big and double-rimmed
      // (dark halo under a white ring) so it reads on light and dark ground
      // alike; `atX` shifts it off the target's centre — on a transcript row
      // the centre is exactly the text being revealed, and covering the
      // payoff with the pointer defeats the frame.
      ring: async (selector, holdMs = 550, atX = 0.5) => {
        await page.evaluate(({ sel, atX }) => {
          const el = document.querySelector(sel);
          const r = el.getBoundingClientRect();
          const dot = document.createElement('div');
          dot.id = 'cap-tap';
          dot.style.cssText = `position:fixed;left:${r.left + r.width * atX - 19}px;top:${r.top + r.height / 2 - 19}px;` +
            'width:38px;height:38px;border-radius:50%;' +
            'border:4px solid rgba(255,255,255,0.98);' +
            'background:rgba(255,255,255,0.30);' +
            'box-shadow:0 0 0 3px rgba(0,0,0,0.45), 0 4px 18px rgba(0,0,0,0.5);' +
            'z-index:2147483647;pointer-events:none;';
          document.body.appendChild(dot);
        }, { sel: selector, atX });
        await t.shoot(holdMs);
        await page.evaluate(() => document.getElementById('cap-tap')?.remove());
      },
      tap: async (selector, holdMs = 550, atX = 0.5) => {
        await t.ring(selector, holdMs, atX);
        await page.click(selector);
      },
      // A real drag across the element, edge to edge: the quick-add overlay
      // listens for mouseup and snaps whatever the drag touched to whole-word
      // boundaries — the same gesture a visitor makes.
      select: async (selector) => {
        const box = await page.locator(selector).boundingBox();
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 2, y, { steps: 6 });
        await page.mouse.up();
        await page.waitForSelector('#lingogram-quick-add-pill', { timeout: 5000 });
      },
      page,
      // Click the row until nothing is masked: the real mode reveals one word
      // per tap, and a story that tapped six times would outstay its welcome.
      revealRest: async (selector) => {
        for (let i = 0; i < 12; i++) {
          const masked = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.includes('*') : false;
          }, selector);
          if (!masked) return;
          await page.click(selector);
          await page.waitForTimeout(120);
        }
      },
    };

    await STORIES[tab].run(t);

    const scaled = await Promise.all(frames.map((f) => sharp(f).resize({ width: WIDTH }).png().toBuffer()));

    // Rotate the loop to open on the feature state (see `start` above). Pure
    // reordering: the same frames, the same holds, the same closed loop —
    // only the entry point moves. `payoff` keeps indexing the FILMED order.
    const start = STORIES[tab].start ?? 0;
    const rotation = scaled.map((_, i) => (i + start) % scaled.length);
    const seq = rotation.map((i) => scaled[i]);
    const seqDelays = rotation.map((i) => delays[i]);

    // Hard cuts read as jumps; crossfade instead. Between every pair of
    // keyframes — including last→first, so the loop closes as softly as it
    // runs — insert FADE_STEPS short alpha-blended frames. Only the changed
    // pixels differ between blends, so WebP inter-frame compression keeps
    // the cost far below FADE_STEPS × frame size.
    const FADE_STEPS = 3;
    const FADE_MS = 70;
    const { width, height } = await sharp(seq[0]).metadata();
    const raws = await Promise.all(seq.map((b) => sharp(b).ensureAlpha().raw().toBuffer()));
    const outFrames = [];
    const outDelays = [];
    for (let i = 0; i < seq.length; i++) {
      outFrames.push(seq[i]);
      outDelays.push(seqDelays[i]);
      const a = raws[i];
      const b = raws[(i + 1) % raws.length];
      for (let k = 1; k <= FADE_STEPS; k++) {
        const mix = k / (FADE_STEPS + 1);
        const buf = Buffer.allocUnsafe(a.length);
        for (let j = 0; j < buf.length; j++) buf[j] = a[j] + (b[j] - a[j]) * mix;
        outFrames.push(await sharp(buf, { raw: { width, height, channels: 4 } }).png().toBuffer());
        outDelays.push(FADE_MS);
      }
    }

    const out = path.join(OUT_DIR, `${tab}-${lang}.webp`);
    await sharp(outFrames, { join: { animated: true } })
      .webp({ quality: 86, delay: outDelays, loop: 0, effort: 5 })
      .toFile(out);
    await sharp(scaled[STORIES[tab].payoff]).webp({ quality: 80 })
      .toFile(path.join(OUT_DIR, `${tab}-static-${lang}.webp`));
    console.log(`${tab}-${lang}: ${Math.round(fs.statSync(out).size / 1024)} KB (${frames.length} frames)`);
  }
  await ctx.close();
}

await browser.close();
server.close();

// A language enters the manifest only with the COMPLETE tab set: the site
// swaps animations per tab, and a partial set would 404 mid-story. Filtered
// dev runs (--tabs/--langs) leave the manifest alone — the site keeps
// serving whatever generation it was last wired to.
if (!argOf('langs') && !argOf('tabs')) {
  const done = ALL_LANGS.filter((lang) =>
    Object.keys(STORIES).every((tab) => fs.existsSync(path.join(OUT_DIR, `${tab}-${lang}.webp`))));
  fs.writeFileSync(LOCALES_JSON, JSON.stringify(done.sort()) + '\n');
  console.log(`manifest: ${done.length} complete languages`);
}
