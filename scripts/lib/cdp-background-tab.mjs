// Opening tabs in the background, and muting them, for CDP runs.
//
// Why: these scripts attach to a Chrome that someone is working in at that
// moment (otherwise YouTube does not serve subtitles — see
// docs/ops/live-debug-cdp.md). So a run has to stay unobtrusive: ctx.newPage()
// creates the tab active, Chrome raises the window to the front and on macOS
// takes the focus, and the video starts playing out loud over whatever that
// person is listening to.
//
// The window is NOT hidden by this — it stays visible, it just does not jump
// to the front.

/**
 * Opens a tab without taking the focus or raising the browser window.
 * Returns a Playwright Page.
 */
export async function openInBackground(ctx, url) {
    const anchor = ctx.pages()[0];
    if (!anchor) throw new Error('The browser has no tabs at all — is a window open?');

    const browserCdp = await ctx.newCDPSession(anchor);
    const { targetId } = await browserCdp.send('Target.createTarget', { url, background: true });
    await browserCdp.detach().catch(() => {});

    // Match strictly on targetId, never on URL: a live browser can hold several
    // identical tabs (left over from earlier runs among them), and matching by
    // URL easily picks somebody else's — then finally closes the wrong one and
    // ours is left hanging.
    for (let i = 0; i < 60; i++) {
        for (const page of ctx.pages()) {
            const session = await ctx.newCDPSession(page).catch(() => null);
            if (!session) continue;
            const info = await session.send('Target.getTargetInfo').catch(() => null);
            await session.detach().catch(() => {});
            if (info?.targetInfo?.targetId === targetId) return page;
        }
        await anchor.waitForTimeout(250);
    }
    throw new Error(`the tab ${url} did not appear in the context within 15s`);
}

/**
 * Mutes the video on a page. Never throws: a run checks subtitles, not sound.
 *
 * Through the site's own player rather than video.muted: YouTube keeps the
 * volume in its own state and restores it over a DOM edit — measured, muted
 * rolls straight back. The interval covers the cases where the player drops
 * the mute by itself (a quality change, the next video in the queue).
 */
export async function mute(page) {
    try {
        await page.waitForLoadState('domcontentloaded');

        const hasYtPlayer = await page.evaluate(
            () => !!document.getElementById('movie_player')?.mute,
        ).catch(() => false);

        if (hasYtPlayer) {
            return await page.evaluate(() => {
                const p = document.getElementById('movie_player');
                p.mute();
                setInterval(() => { if (!p.isMuted?.()) p.mute(); }, 1000);
                return 'muted';
            });
        }

        // Every other site (rezka, netflix) — a plain <video>.
        //
        // Waiting for the player is spent only on pages where one may STILL
        // appear: media does not start immediately, so on a watch page the wait
        // is still required. But popup.html, the home page, the search page and
        // about:blank never carry video, and the unconditional wait used to
        // burn the whole 15s budget on them.
        //
        // Measured: reading and restoring settings opens popup.html twice per
        // check — 30s wasted on each. Across 59 such wrappers that is ~29
        // minutes of a 41-minute run.
        const state = await page.evaluate(() => ({
            has: !!document.querySelector('video,audio'),
            watch: /\/watch|\/shorts\/|netflix\.com\/watch|rezka/.test(location.href),
        })).catch(() => ({ has: false, watch: false }));

        if (!state.has && !state.watch) return 'nothing to mute — the page carries no media';

        if (!state.has) {
            await page.waitForFunction(() => document.querySelector('video'), null, { timeout: 15000 });
        }
        return await page.evaluate(() => {
            const keep = () => document.querySelectorAll('video,audio')
                .forEach((v) => { v.muted = true; });
            keep();
            setInterval(keep, 1000);
            return 'muted';
        });
    } catch {
        return 'could not mute (the player never appeared) — the check carries on';
    }
}
