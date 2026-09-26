/**
 * The line-step bar under the on-screen captions (‹ ↺ ›), in a real browser.
 *
 * The unit tests cover the logic; what they cannot see lives in CSS and in the
 * browser's hit-testing — jsdom applies no stylesheet and answers every
 * geometry question with zero. Four defects of exactly that kind were found by
 * hand while building this (↺'s hover area swallowing presses on ‹, the row
 * folding under a resting cursor, the captions dropping from under ↺ when the
 * player hid its bar, the bar left lit after the pointer left the page); these
 * checks keep them found.
 *
 * YouTube only. The bar is the same shared code on every site, and the parts
 * checked here that are site-specific (the player's control bar) are YouTube's.
 *
 * Own page, in a background WINDOW rather than the shared background tab: a
 * hidden tab runs no animation frames, and the bar measures the pointer on
 * one. A window opened in the background is visible without taking focus.
 */
import type { Page } from '@playwright/test';
import { test, expect, type ExtensionHandle } from './fixtures/extension';
import { WATCH_URL } from './fixtures/sites';
import { waitForLines } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';
// The same helper the fixture mutes its own tabs with.
import { mute } from '../scripts/lib/cdp-background-tab.mjs';

test.describe.configure({ mode: 'serial' });

async function openVisible(ext: ExtensionHandle, url: string): Promise<Page> {
    const anchor = ext.ctx.pages()[0];
    const s = await ext.ctx.newCDPSession(anchor);
    const { targetId } = await s.send('Target.createTarget', { url, background: true, newWindow: true });
    await s.detach().catch(() => {});
    for (let i = 0; i < 60; i++) {
        for (const page of ext.ctx.pages()) {
            const ss = await ext.ctx.newCDPSession(page).catch(() => null);
            if (!ss) continue;
            const info = await ss.send('Target.getTargetInfo').catch(() => null);
            await ss.detach().catch(() => {});
            if (info?.targetInfo?.targetId === targetId) {
                ext.loads.total++;
                await mute(page);
                return page;
            }
        }
        await anchor.waitForTimeout(250);
    }
    throw new Error('the window did not appear');
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number; cx: number; cy: number };

/** Everything the checks read, in one round trip. */
const read = (page: Page) =>
    page.evaluate(() => {
        const box = (el: Element | null | undefined) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        };
        const o = document.getElementById('vtt-video-overlay')!;
        const nav = o.querySelector('.vtt-cue-nav');
        const boxes = [...o.querySelectorAll('.vtt-overlay-main, .vtt-overlay-sub')];
        const player = document.getElementById('movie_player')!;
        const v = document.querySelector('video')!;
        return {
            near: o.classList.contains('vtt-cue-nav-near'),
            navOpacity: nav ? getComputedStyle(nav).opacity : null,
            nav: box(nav),
            prev: box(o.querySelector('.vtt-cue-nav-prev')),
            replay: box(o.querySelector('.vtt-cue-nav-replay')),
            next: box(o.querySelector('.vtt-cue-nav-next')),
            main: box(o.querySelector('.vtt-overlay-main')),
            low: box(boxes[boxes.length - 1]),
            held: o.querySelector('.vtt-overlay-held') ? getComputedStyle(o.querySelector('.vtt-overlay-held')!).opacity : null,
            text: o.querySelector('.vtt-overlay-main')?.textContent ?? null,
            floor: parseFloat(getComputedStyle(o).getPropertyValue('--vtt-overlay-floor')) || 0,
            space: parseFloat(o.style.getPropertyValue('--vtt-cue-nav-space')) || 0,
            pinned: !!(nav as HTMLElement | null)?.style.top,
            playerBottom: player.getBoundingClientRect().bottom,
            t: v.currentTime,
            paused: v.paused,
        };
    }) as Promise<{
        near: boolean; navOpacity: string | null; nav: Box | null; prev: Box | null; replay: Box | null; next: Box | null;
        main: Box | null; low: Box | null; held: string | null; text: string | null; floor: number; space: number;
        pinned: boolean; playerBottom: number; t: number; paused: boolean;
    }>;

/** Which element the browser would deliver a press at (x, y) to. */
const hitAt = (page: Page, x: number, y: number) =>
    page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el?.closest('.vtt-cue-nav-btn')?.className.match(/vtt-cue-nav-(prev|replay|next)/)?.[1] ?? null;
    }, [x, y]);

let ext: ExtensionHandle;
let page: Page;

async function lineOnScreen(): Promise<void> {
    await expect.poll(async () => (await read(page)).main?.width ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
}

/**
 * Park the cursor far from the captions and let the bar go — inside the player,
 * so YouTube keeps its own bar up and every measurement sees the same floor.
 */
async function away(): Promise<void> {
    const p = await page.evaluate(() => {
        const r = document.getElementById('movie_player')!.getBoundingClientRect();
        return { x: r.left + 30, y: r.top + 30 };
    });
    await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await read(page)).near, { timeout: 5_000 }).toBe(false);
    await page.waitForTimeout(300); // the unpin that follows the fade
}

/**
 * Bring the cursor under the lowest caption box and wait for the bar — off to
 * the side: straight under the centre is ↺'s own hover area, which is "on the
 * bar", not merely near it.
 */
async function approach(): Promise<void> {
    const s = await read(page);
    await page.mouse.move(s.low!.left + 20, s.low!.bottom + 12);
    await expect.poll(async () => (await read(page)).near, { timeout: 5_000 }).toBe(true);
    // Arriving can lift the captions (0.25s), carrying ↺ away from where it
    // was measured. The bar pins once that has settled — measure after that.
    await expect.poll(async () => (await read(page)).pinned, { timeout: 3_000 }).toBe(true);
}

/** Onto ↺ — and wait for the layout to settle, since arriving can lift the captions. */
async function onReplay(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const s = await read(page);
        await page.mouse.move(s.replay!.cx, s.replay!.cy);
        await page.waitForTimeout(400);
    }
}

/** Keep YouTube's own bar up without playing: a paused player does not hide it. */
async function pauseAt(seconds: number): Promise<void> {
    await page.evaluate((t) => {
        const v = document.querySelector('video')!;
        v.currentTime = t;
        v.pause();
    }, seconds);
    await page.mouse.move(640, 200);
    await page.waitForTimeout(500);
    await lineOnScreen();
}

test.beforeAll(async ({ ext: handle }) => {
    ext = handle;
    page = await openVisible(ext, WATCH_URL);
    await waitForLines(page);
    await expect
        .poll(() => page.evaluate(() => document.getElementById('movie_player')?.classList.contains('ad-showing') ?? true), { timeout: 90_000 })
        .toBe(false);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    await pauseAt(30);
});

test.afterAll(async () => {
    await page?.close().catch(() => {});
});

test('with the cursor away the bar is invisible and takes no press', async () => {
    await away();
    await expect.poll(async () => (await read(page)).navOpacity, { timeout: 2_000 }).toBe('0');
    const s = await read(page);
    expect(await hitAt(page, s.replay!.cx, s.replay!.cy)).toBeNull();
});

test('near the captions only ↺ shows, at half strength', async () => {
    await away();
    await approach();
    await expect.poll(async () => (await read(page)).navOpacity, { timeout: 2_000 }).toBe('0.5');
    const s = await read(page);
    expect(s.prev!.width).toBe(0);
    expect(s.next!.width).toBe(0);
    expect(s.replay!.width).toBeGreaterThan(0);
});

test('the cursor 45px under the captions is not near', async () => {
    await away();
    const s = await read(page);
    await page.mouse.move(s.low!.cx, s.low!.bottom + 45);
    await page.waitForTimeout(500);
    expect((await read(page)).near).toBe(false);
});

test('the hover area around ↺ unfolds ‹ ›, and each press lands on its own button', async () => {
    await away();
    await approach();
    const s0 = await read(page);
    // Inside the 44px area but off the icon itself.
    await page.mouse.move(s0.replay!.cx + 16, s0.replay!.cy);
    await expect.poll(async () => (await read(page)).prev?.width ?? 0, { timeout: 3_000 }).toBeGreaterThan(0);
    // Opacity animates (0.18s): wait for where it settles, not a frame of the way.
    await expect.poll(async () => (await read(page)).navOpacity, { timeout: 5_000 }).toBe('1');
    const s = await read(page);
    // ‹ is painted before ↺, whose hover area spills over it: without its
    // z-index a press on ‹ went to ↺ and replayed the line.
    expect(await hitAt(page, s.prev!.cx, s.prev!.cy)).toBe('prev');
    expect(await hitAt(page, s.replay!.cx, s.replay!.cy)).toBe('replay');
    expect(await hitAt(page, s.next!.cx, s.next!.cy)).toBe('next');
});

test('keyboard focus shows and unfolds the bar with the cursor away', async () => {
    await pauseAt(30);
    await away();
    // :focus-visible follows keyboard use; a key press first makes the
    // scripted focus count as one.
    await page.keyboard.press('Shift');
    await page.evaluate(() => (document.querySelector('#vtt-video-overlay .vtt-cue-nav-replay') as HTMLElement).focus());
    try {
        await expect.poll(async () => (await read(page)).navOpacity, { timeout: 2_000 }).toBe('1');
        const s = await read(page);
        expect(s.near).toBe(false);
        expect(s.prev!.width).toBeGreaterThan(0);
        expect(await hitAt(page, s.prev!.cx, s.prev!.cy)).toBe('prev');
    } finally {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
});

test('‹ › ↺ step by line and playback goes on', async () => {
    const activeIndex = () =>
        page.evaluate(() => Number(document.querySelector('#vtt-list .vtt-item.active-sub')?.getAttribute('data-index') ?? -1));
    const video = (fn: 'play' | 'pause') => page.evaluate((f) => void document.querySelector('video')![f](), fn);
    // Aim at the unfolded button, press, and read the landing line at once:
    // playback goes on, so a slow read would see the line after it.
    const press = async (which: 'prev' | 'replay' | 'next', expected: number) => {
        await approach();
        await onReplay();
        const b = (await read(page))[which]!;
        const tBefore = (await read(page)).t;
        await page.mouse.click(b.cx, b.cy);
        await expect.poll(activeIndex, { timeout: 2_000, intervals: [50] }).toBe(expected);
        await page.waitForTimeout(400);
        const s = await read(page);
        expect(s.paused).toBe(false);
        return { tBefore, tAfter: s.t };
    };

    await pauseAt(30);
    await away();
    const start = await activeIndex();
    expect(start).toBeGreaterThan(0);

    await press('prev', start - 1);
    await video('pause');
    const here = await activeIndex();
    await press('next', here + 1);
    await video('pause');

    // ↺: let a line play past its first second, then restart it.
    let line = -1;
    for (let attempt = 0; attempt < 5 && line === -1; attempt++) {
        await video('play');
        const from = await activeIndex();
        await expect.poll(activeIndex, { timeout: 15_000, intervals: [50] }).not.toBe(from);
        const begun = await activeIndex();
        await page.waitForTimeout(1_200);
        if ((await activeIndex()) === begun) line = begun;
    }
    expect(line).toBeGreaterThanOrEqual(0);
    const r = await press('replay', line);
    expect(r.tAfter).toBeLessThan(r.tBefore);
    await video('pause');
});

test('between lines the line that ended stays up, dimmed, and ‹ goes back to it', async () => {
    await pauseAt(30);
    await away();
    // Play with the cursor away until a line ends and nothing is on screen.
    await page.evaluate(() => void document.querySelector('video')!.play());
    await expect.poll(async () => (await read(page)).main === null, { timeout: 60_000, intervals: [100] }).toBe(true);
    await page.evaluate(() => document.querySelector('video')!.pause());

    // Approach where the line was: the zone outlives the box that drew it.
    const lastLow = await page.evaluate(() => {
        const o = document.getElementById('vtt-video-overlay')!;
        const r = o.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom + 12 };
    });
    await page.mouse.move(lastLow.x, lastLow.y);
    await expect.poll(async () => (await read(page)).held, { timeout: 5_000 }).toBe('0.55'); // held opacity is not animated
    const held = (await read(page)).text;
    expect(held).not.toBeNull();

    await onReplay();
    const b = (await read(page)).prev!;
    await page.mouse.click(b.cx, b.cy);
    await expect.poll(async () => (await read(page)).text, { timeout: 5_000 }).toBe(held);
    expect((await read(page)).held).toBeNull(); // playing it again, not holding it
    await page.evaluate(() => document.querySelector('video')!.pause());
});

test('the captions rise only by the room the bar is missing above the player bar', async () => {
    const nudged = async (nudge: string) => {
        await pauseAt(30);
        const original = await page.evaluate(
            (n) => {
                const o = document.getElementById('vtt-video-overlay')!;
                const was = o.style.getPropertyValue('--vtt-overlay-nudge');
                o.style.setProperty('--vtt-overlay-nudge', n);
                return was;
            },
            nudge,
        );
        try {
            await away();
            const far = await read(page);
            await approach();
            await page.waitForTimeout(400);
            const near = await read(page);
            const floorLine = near.playerBottom - near.floor;
            const room = floorLine - far.low!.bottom;
            // The bar hangs 4px under the overlay, whose edge can sit a few px
            // under the last box: measure what is needed from the bar itself.
            const needed = far.nav!.bottom - far.low!.bottom;
            return { lift: far.low!.bottom - near.low!.bottom, room, needed, navBottom: near.nav!.bottom, floorLine };
        } finally {
            await page.evaluate((w) => {
                const o = document.getElementById('vtt-video-overlay')!;
                if (w) o.style.setProperty('--vtt-overlay-nudge', w);
                else o.style.removeProperty('--vtt-overlay-nudge');
            }, original);
        }
    };

    const high = await nudged('15%');
    expect(high.room).toBeGreaterThan(high.needed);
    expect(high.lift).toBe(0);

    const low = await nudged('0%');
    expect(Math.abs(low.lift - Math.max(0, low.needed - low.room))).toBeLessThanOrEqual(1);
    expect(low.navBottom).toBeLessThanOrEqual(low.floorLine + 1);
});

test('once in use the bar stays put when the captions move', async () => {
    await pauseAt(30);
    await away();
    await approach();
    await onReplay();
    await page.waitForTimeout(400); // past the pin delay
    const before = await read(page);
    expect(before.pinned).toBe(true);
    await page.evaluate(() => {
        const st = document.createElement('style');
        st.id = 'cue-nav-probe';
        st.textContent = '#vtt-video-overlay { bottom: 40px !important; transition: none !important; }';
        document.head.appendChild(st);
    });
    try {
        await page.waitForTimeout(300);
        const after = await read(page);
        expect(Math.abs(after.low!.bottom - before.low!.bottom)).toBeGreaterThan(20);
        expect(Math.abs(after.nav!.top - before.nav!.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.nav!.cx - before.nav!.cx)).toBeLessThanOrEqual(1);
    } finally {
        await page.evaluate(() => document.getElementById('cue-nav-probe')?.remove());
    }
});

test('the player hiding its bar does not drop the captions from under the cursor', async () => {
    await pauseAt(30);
    await away();
    await approach();
    const autohide = (on: boolean) =>
        page.evaluate((v) => document.getElementById('movie_player')!.classList.toggle('ytp-autohide', v), on);
    const before = (await read(page)).low!.bottom;
    await autohide(true);
    try {
        await page.waitForTimeout(400);
        expect(Math.abs((await read(page)).low!.bottom - before)).toBeLessThanOrEqual(1);

        // The same class with the cursor away does drop them — so what held
        // them above was the bar being in use, not the class failing to apply.
        await page.mouse.move(8, 8);
        await expect.poll(async () => (await read(page)).near, { timeout: 5_000 }).toBe(false);
        await page.waitForTimeout(400);
        expect((await read(page)).low!.bottom).toBeGreaterThan(before + 20);
    } finally {
        await autohide(false);
    }
});

test('the move grip is drawn like the bar: bare, full strength, the same gap above as the bar keeps below', async () => {
    await pauseAt(30);
    await away();
    const panelOpen = () => page.evaluate(() => document.getElementById('vtt-settings-panel')?.classList.contains('open') === true);
    const toggle = () => page.evaluate(() => document.getElementById('vtt-settings-btn')?.click());
    if (!(await panelOpen())) await toggle();
    try {
        await expect.poll(panelOpen, { timeout: 10_000 }).toBe(true);
        await expect
            .poll(() => page.evaluate(() => document.getElementById('vtt-video-overlay')?.classList.contains('vtt-overlay-adjusting')), { timeout: 10_000 })
            .toBe(true);
        const g = await page.evaluate(() => {
            const grip = document.querySelector('#vtt-video-overlay .vtt-overlay-handle') as HTMLElement;
            const main = document.querySelector('#vtt-video-overlay .vtt-overlay-main') as HTMLElement;
            const cs = getComputedStyle(grip);
            const gr = grip.getBoundingClientRect();
            const mr = main.getBoundingClientRect();
            const bar = document.querySelector('#vtt-video-overlay .vtt-cue-nav') as HTMLElement | null;
            return {
                background: cs.backgroundColor, border: cs.borderTopWidth, opacity: cs.opacity, filter: cs.filter,
                color: cs.color,
                // The user's caption colour setting, resolved the same way.
                captionColor: (() => {
                    const probe = document.createElement('span');
                    probe.style.color = 'var(--vtt-overlay-color, #fff)';
                    main.appendChild(probe);
                    const c = getComputedStyle(probe).color;
                    probe.remove();
                    return c;
                })(),
                gap: Math.round(mr.top - gr.bottom), height: Math.round(gr.height),
                barHeight: bar ? Math.round(bar.querySelector('.vtt-cue-nav-replay')!.getBoundingClientRect().height) : null,
            };
        });
        expect(g.background).toBe('rgba(0, 0, 0, 0)');
        expect(g.border).toBe('0px');
        expect(g.opacity).toBe('1');
        expect(g.filter).toContain('drop-shadow');
        expect(g.color).toBe(g.captionColor);
        expect(g.gap).toBe(4);
        expect(g.height).toBe(g.barHeight);
    } finally {
        if (await panelOpen()) await toggle();
    }
});

test('dragging the captions carries the bar, and it pins again where they land', async () => {
    await preservingUiPrefs(ext, async () => {
        await pauseAt(30);
        await away();
        await approach();
        await onReplay();
        await page.waitForTimeout(400);
        const s = await read(page);
        // The caption box's own border is a drag surface.
        const ring = { x: s.main!.left + 3, y: s.main!.cy };
        await page.mouse.move(ring.x, ring.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        const gaps: number[] = [];
        const offsets: number[] = [];
        for (let k = 1; k <= 6; k++) {
            await page.mouse.move(ring.x + k * 15, ring.y - k * 10);
            await page.waitForTimeout(80);
            const d = await read(page);
            gaps.push(Math.round(d.nav!.top - d.low!.bottom));
            offsets.push(Math.round(d.nav!.cx - d.main!.cx));
        }
        await page.mouse.up();
        const moved = await read(page);
        // A long line has little room sideways (the frame edges bound it), so
        // the move is measured on both axes together.
        expect(Math.hypot(moved.main!.cx - s.main!.cx, moved.main!.cy - s.main!.cy)).toBeGreaterThan(30);
        expect(new Set(gaps).size).toBe(1);
        expect(offsets.every((o) => Math.abs(o) <= 1)).toBe(true);

        await page.waitForTimeout(300);
        const settled = await read(page);
        expect(settled.pinned).toBe(true);
        expect(Math.abs(settled.nav!.cx - settled.main!.cx)).toBeLessThanOrEqual(1);
    });
    // The drag saved a position; the restore above puts the prefs back, and a
    // reload of the overlay style follows on the next line change.
});
