// ── Control-bar floor for the on-video overlay ──────────────────────────────
// The overlay must clear YouTube's bottom control bar while the bar is
// visible, the way native captions do. The needed clearance is NOT a
// constant: YouTube's stylesheet gives its captions a different bottom margin
// per player mode (61px normal, 70px .ytp-big-mode, 86px .ytp-delhi-modern —
// that one resolved through a CSS variable — 53px embeds, 45px native
// controls...), so the only reliable source is the live geometry of the bar
// itself.
//
// Everything here is READ-ONLY with respect to YouTube's DOM. We measure
// #movie_player / .ytp-chrome-bottom rects and publish the result through our
// own <style> element as --vtt-yt-controls-floor; styles.css turns that into
// a max() floor on the overlay's `bottom` and zeroes it while the bar is
// hidden (.ytp-autohide / .ytp-hide-controls). Publishing via a stylesheet
// instead of an inline property survives the overlay element being torn down
// and recreated on video changes.
//
// Never mutate what you observe: the MutationObserver below watches
// #movie_player's class attribute, which YouTube itself reads and writes
// constantly. A previous attempt toggled those classes to "unhide" the bar
// for measurement and fed back through YouTube's own observers into a loop
// (a `measuring` flag doesn't help — observer callbacks are async and arrive
// after the flag is reset). Measuring real geometry needs no class juggling:
// when the bar is hidden (display: none under ytp-hide-controls → zero-size
// rect; same behind YouTube's bot-check error screen) we keep the last known
// value, and CSS has already floored the overlay to 0 in that state anyway.

const FLOOR_STYLE_ID = 'yt-vtt-controls-floor';

// Native delhi-mode captions sit at calc(controls height + 14px); the same
// gap above the bar's top edge lands within a few px of the native margin in
// the other modes too (normal: ~47px bar top + 14 ≈ 61px).
const FLOOR_GAP_PX = 14;

// Clearance (in px, from the player's bottom edge) that puts the overlay just
// above the control bar — or null when the bar has no trustworthy geometry
// (hidden via display:none, not laid out yet, or the whole player collapsed).
export function computeControlsFloor(playerRect: DOMRect, barRect: DOMRect): number | null {
    if (playerRect.height === 0 || barRect.height === 0) return null;
    const floor = Math.round(playerRect.bottom - barRect.top) + FLOOR_GAP_PX;
    // A bar that measures at or below the player's bottom edge is not the
    // visible control bar sitting over the video — don't trust it.
    return floor > FLOOR_GAP_PX ? floor : null;
}

export function watchControlsFloor(): void {
    let applied = 0;
    let scheduled = false;

    const measure = (): void => {
        scheduled = false;
        const player = document.getElementById('movie_player');
        const bar = player?.querySelector('.ytp-chrome-bottom');
        if (!player || !bar) return;
        const floor = computeControlsFloor(player.getBoundingClientRect(), bar.getBoundingClientRect());
        if (floor === null || floor === applied) return;
        applied = floor;
        let style = document.getElementById(FLOOR_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = FLOOR_STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = `#movie_player #vtt-video-overlay { --vtt-yt-controls-floor: ${floor}px; }`;
        console.log('[YT-VTT] controls floor ->', floor);
    };

    // Coalesce bursts (class flips + resizes arrive together) into one
    // measurement per frame.
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(measure);
    };

    // (Re-)attach the observers to the current player/bar elements. Safe to
    // call repeatedly — YouTube tears down and rebuilds the player chrome on
    // SPA navigation, so the references go stale.
    let observedPlayer: Element | null = null;
    let observedBar: Element | null = null;
    const classObserver = new MutationObserver(schedule);
    const sizeObserver = new ResizeObserver(schedule);

    const arm = (): boolean => {
        const player = document.getElementById('movie_player');
        const bar = player?.querySelector('.ytp-chrome-bottom') ?? null;
        if (!player || !bar) return false;
        if (player !== observedPlayer || bar !== observedBar) {
            classObserver.disconnect();
            sizeObserver.disconnect();
            // Class attr only, no subtree: mode switches (big/delhi/embed) and
            // bar visibility (autohide) all announce themselves here, and we
            // never write these classes back, so observing can't self-trigger.
            classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
            // The bar's own size changes on mode switches that don't resize
            // the player (delhi toggle); the player's on everything else.
            sizeObserver.observe(player);
            sizeObserver.observe(bar);
            observedPlayer = player;
            observedBar = bar;
        }
        schedule();
        return true;
    };

    // The player may not exist yet on first script run (or right after an SPA
    // navigation) — retry briefly, then give up rather than polling forever
    // on a page where it never appears. Mirrors installPlayerControlButton.
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    const armWithRetry = (): void => {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        if (arm()) return;
        let attempts = 0;
        retryTimer = setInterval(() => {
            attempts++;
            if (arm() || attempts >= 150) { // ~30s cap
                if (retryTimer) clearInterval(retryTimer);
                retryTimer = null;
            }
        }, 200);
    };

    armWithRetry();
    document.addEventListener('yt-navigate-finish', armWithRetry);
}
