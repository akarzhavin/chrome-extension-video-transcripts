// Step by line from the on-screen subtitles: previous, replay, next.
//
// The problem it answers is timing, not navigation: a learner hears a word,
// reaches for the caption to look it up, and the line has changed before the
// cursor arrives. Rewinding by seconds overshoots by several lines. So the
// controls step by LINE, and playback goes on from the line landed on.
//
// They are invisible until the cursor comes near the captions, and even then
// only ↺ shows; ‹ › unfold when the cursor reaches ↺. Chosen from a lab of
// two dozen variants: everything that put more than the buttons themselves on
// screen (counters, previews, hint marks, key letters) was rejected.
//
// Split in two: the target arithmetic is pure and exported for tests, the DOM
// controller owns one long-lived element. The overlay rebuilds its children
// ~4x/sec; a control rebuilt with them would drop its :hover under a resting
// cursor and fold shut while being aimed at — the same reason the grip is kept.

import { msg } from './i18n';

export type CueNavAction = 'prev' | 'replay' | 'next';

/** Line boundaries only; the text is irrelevant to where a step lands. */
interface Cue {
    startTime: number;
    endTime: number;
}

/**
 * How near the captions the cursor has to come before the controls appear.
 * Close to the height of ↺ plus its gap: the controls show up when the cursor
 * is about where they will be, not while it merely crosses the lower frame.
 * (Was 60; the user found that too eager.)
 */
export const CUE_NAV_RADIUS_PX = 30;

/**
 * How long the controls outlive the cursor leaving. Without it a hand that
 * overshoots by a few pixels on the way to ‹ makes the target vanish.
 */
export const CUE_NAV_LEAVE_MS = 700;

/** The gap between the lowest caption box and the controls (`top: calc(100% + 4px)`). */
const CUE_NAV_GAP_PX = 4;

/**
 * How long after the cursor arrives the controls pin in place. Arriving can
 * itself move the captions — the player's bar appears, the overlay makes room
 * for the controls — and that 0.25s settle is left to finish first, so the pin
 * lands where the controls will stay rather than where they were mid-slide.
 */
export const CUE_NAV_PIN_DELAY_MS = 300;

/**
 * How long after they hide the controls unpin. They fade out over ~0.2s; going
 * back under the caption before that would show them jump on the way out.
 */
export const CUE_NAV_UNPIN_DELAY_MS = 200;

/**
 * Seek this far past a line's start. A player reports the time back rounded
 * (Netflix seeks in whole milliseconds) and a start of 12.3404 read back as
 * 12.340 belongs to the line BEFORE it under the end-exclusive rule — the jump
 * would show the wrong line and the next ‹ would skip one. 10 ms is below
 * anything audible.
 */
export const CUE_NAV_SEEK_PAD_S = 0.01;

/** The line playing at `time`, by the same end-exclusive rule as highlightSubtitle. */
function playingIndex(track: readonly Cue[], time: number): number {
    return track.findIndex(c => time >= c.startTime && time < c.endTime);
}

/**
 * The most recent line that has started by `time`, or −1 before the first.
 *
 * Between lines this is the one that just ENDED — the line the word was in.
 */
function lastStartedIndex(track: readonly Cue[], time: number): number {
    let last = -1;
    for (let i = 0; i < track.length; i++) {
        if (track[i].startTime <= time) last = i;
    }
    return last;
}

/**
 * Which line a step lands on, or null when there is nowhere to go.
 *
 * "Back" depends on where the playhead is. Inside line N it means N−1. In the
 * silence after line N it means N itself: the line has already gone from the
 * screen, and it is the one the learner was reaching for. Counting from N there
 * would skip exactly the line the control exists for.
 */
export function cueNavTarget(track: readonly Cue[], time: number, action: CueNavAction): number | null {
    if (!track.length) return null;
    const playing = playingIndex(track, time);
    const base = playing !== -1 ? playing : lastStartedIndex(track, time);
    if (action === 'next') {
        const next = base + 1;
        return next < track.length ? next : null;
    }
    if (base === -1) return null; // before the first line: nothing behind us
    if (action === 'replay') return base;
    return playing !== -1 ? Math.max(0, playing - 1) : base;
}

/**
 * The line to keep on screen, dimmed, while the cursor is near the captions
 * and none is playing — or −1 when a line is playing or none has been yet.
 *
 * Between lines the caption box disappears, and the controls hang from it: a
 * cursor on its way to ‹ would see the target vanish under it.
 */
export function heldCueIndex(track: readonly Cue[], time: number): number {
    if (playingIndex(track, time) !== -1) return -1;
    return lastStartedIndex(track, time);
}

export interface CueNavHost {
    onAction(action: CueNavAction): void;
    /** The cursor entered or left the zone around the captions. */
    onNearChange(near: boolean): void;
}

const ICONS: Record<CueNavAction, string> = {
    prev: '<path d="M15 5l-7 7 7 7"/>',
    replay: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M6.5 3.5v4h4"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
};

function label(action: CueNavAction): string {
    if (action === 'prev') return msg('ytOverlayCuePrev', 'Previous line');
    if (action === 'replay') return msg('ytOverlayCueReplay', 'Replay line');
    return msg('ytOverlayCueNext', 'Next line');
}

interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// Distance from a point to a rectangle; zero inside it.
function distance(r: Box, x: number, y: number): number {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
}

export class CueNav {
    readonly el: HTMLDivElement;
    private overlay: HTMLElement | null = null;
    private near = false;
    private leaveTimer: ReturnType<typeof setTimeout> | null = null;
    private frame = 0;
    private lastPointer: { x: number; y: number; target: EventTarget | null } | null = null;
    // Where the caption boxes last stood. Between lines there is no box to
    // measure, and that silence is exactly when the learner reaches for the
    // line that just went — so the zone outlives the boxes that drew it.
    private lastZone: Box[] = [];
    private layoutFrame = 0;
    // Where the controls are held while in use, in the PLAYER's coordinates:
    // their centre x and top y. Otherwise they hang under the lowest caption
    // box, and that box moves with every line — a two-line cue, a larger font,
    // a line too tall for a raised position all shift its bottom edge — so the
    // target jumped between presses. null = following the caption as usual.
    private pinned: { cx: number; top: number } | null = null;
    // The captions are being moved by hand: the controls ride with them
    // instead of staying pinned where the drag began.
    private suspended = false;
    // The captions were placed by hand while the controls were near. The
    // reserve under them (--vtt-cue-nav-min-bottom) is off until the cursor
    // leaves: during the drag it made the lowest stretch above the bar
    // unreachable, and after the release it held the caption higher than
    // where it was let go, then dropped it once the cursor left.
    private placed = false;
    private pinTimer: ReturnType<typeof setTimeout> | null = null;
    private followFrame = 0;
    // Re-applied every frame while pinned: the overlay moves by transition
    // (the player's bar), by rebuild (a taller line) and by drag, and the
    // controls sit inside it, so their offset has to cancel each move.
    private readonly follow = () => {
        this.followFrame = 0;
        const overlay = this.overlay;
        const host = overlay?.parentElement;
        if (!this.pinned || !overlay || !host) return;
        const o = overlay.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        this.el.style.left = `${h.left + this.pinned.cx - o.left}px`;
        this.el.style.top = `${h.top + this.pinned.top - o.top}px`;
        this.followFrame = requestAnimationFrame(this.follow);
    };
    private readonly onPointerMove = (e: PointerEvent) => {
        // Touch has no hover to approach with; a tap would light the controls
        // and leave them lit with no cursor to lead them away.
        if (e.pointerType === 'touch') return;
        this.lastPointer = { x: e.clientX, y: e.clientY, target: e.target };
        // One measurement per frame, however fast the pointer reports.
        if (!this.frame) this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.evaluate();
        });
    };

    // The pointer left the document — out of the window, or into an iframe,
    // neither of which reports pointermove here. Without this the controls
    // would stay lit until the cursor happened to come back.
    private readonly onMouseOut = (e: MouseEvent) => {
        if (e.relatedTarget) return;
        this.scheduleLeave();
    };

    constructor(private readonly host: CueNavHost) {
        const nav = document.createElement('div');
        nav.className = 'vtt-cue-nav';
        for (const action of ['prev', 'replay', 'next'] as const) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `vtt-cue-nav-btn vtt-cue-nav-${action}`;
            btn.dataset.action = action;
            const text = label(action);
            btn.title = text;
            btn.setAttribute('aria-label', text);
            btn.innerHTML =
                '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
                'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS[action] + '</svg>';
            btn.addEventListener('click', () => this.host.onAction(action));
            nav.appendChild(btn);
        }
        // The controls sit INSIDE the player, which toggles playback on a click
        // anywhere on itself — so every step would also resume the video it
        // just paused. The whole pointer→mouse→click chain stops here, as it
        // does on the grip.
        for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'] as const) {
            nav.addEventListener(type, (e) => e.stopPropagation());
        }
        // A pressed button would otherwise KEEP focus, and the player's own
        // Space-to-pause would then press it again instead: the learner stops
        // the video to read a word and lands one more line back. Keyboard users
        // still reach the buttons by Tab — only the mouse is denied focus.
        nav.addEventListener('mousedown', (e) => e.preventDefault());
        this.el = nav;
        document.addEventListener('pointermove', this.onPointerMove, { passive: true });
        document.addEventListener('mouseout', this.onMouseOut);
    }

    /** Bind to a (possibly re-created) overlay and restore the current state on it. */
    attach(overlay: HTMLElement): void {
        this.overlay = overlay;
        overlay.classList.toggle('vtt-cue-nav-near', this.near);
        overlay.classList.toggle('vtt-cue-nav-placed', this.placed);
    }

    /**
     * The overlay has painted a line: remember where its boxes are. Measured on
     * the next frame, after the browser lays the rebuild out anyway, rather
     * than forcing a layout in the middle of it.
     */
    noteLayout(): void {
        if (this.layoutFrame) return;
        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = 0;
            this.measureBoxes();
        });
    }

    isNear(): boolean {
        return this.near;
    }

    destroy(): void {
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('mouseout', this.onMouseOut);
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame);
        this.clearPinTimer();
        this.unpin();
        if (this.leaveTimer) clearTimeout(this.leaveTimer);
        this.el.remove();
        this.overlay = null;
    }

    /** Where the pointer is now decides whether the controls are wanted. */
    private evaluate(): void {
        const p = this.lastPointer;
        if (!p) return;
        if (this.isInZone(p.x, p.y, p.target)) {
            if (this.leaveTimer) { clearTimeout(this.leaveTimer); this.leaveTimer = null; }
            this.setNear(true);
        } else {
            this.scheduleLeave();
        }
    }

    private scheduleLeave(): void {
        if (!this.near || this.leaveTimer) return;
        this.leaveTimer = setTimeout(() => {
            this.leaveTimer = null;
            this.setNear(false);
        }, CUE_NAV_LEAVE_MS);
    }

    private isInZone(x: number, y: number, target: EventTarget | null): boolean {
        const overlay = this.overlay;
        if (!overlay || !overlay.isConnected) return false;
        if (target instanceof Node && this.el.contains(target)) return true;
        this.measureBoxes();
        return this.lastZone.some(r => distance(r, x, y) <= CUE_NAV_RADIUS_PX);
    }

    // Refresh lastZone from the boxes on screen; keep the old one when there
    // are none (between lines).
    private measureBoxes(): void {
        const overlay = this.overlay;
        if (!overlay || !overlay.isConnected) return;
        // Room the captions have to leave under themselves for the controls —
        // their real height, which follows the player's size, not a worst case.
        // Laid out even while hidden (opacity), so it is known before they show.
        const navHeight = this.el.offsetHeight;
        if (navHeight > 0) overlay.style.setProperty('--vtt-cue-nav-space', `${navHeight + CUE_NAV_GAP_PX}px`);
        const boxes: Box[] = [];
        for (const box of Array.from(overlay.querySelectorAll<HTMLElement>('.vtt-overlay-main, .vtt-overlay-sub'))) {
            const r = box.getBoundingClientRect();
            // Not laid out (hidden overlay, jsdom): no zone rather than a zone
            // at the top-left corner of the page.
            if (r.width === 0 || r.height === 0) continue;
            boxes.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        }
        if (boxes.length) this.lastZone = boxes;
    }

    private setNear(near: boolean): void {
        if (near === this.near) return;
        this.near = near;
        this.overlay?.classList.toggle('vtt-cue-nav-near', near);
        if (!near) this.setPlaced(false);
        this.clearPinTimer();
        if (near) {
            // Back within the unpin delay: still pinned, nothing to redo.
            if (!this.pinned) this.pinTimer = setTimeout(() => { this.pinTimer = null; this.pin(); }, CUE_NAV_PIN_DELAY_MS);
        } else {
            this.pinTimer = setTimeout(() => { this.pinTimer = null; this.unpin(); }, CUE_NAV_UNPIN_DELAY_MS);
        }
        this.host.onNearChange(near);
    }

    private setPlaced(placed: boolean): void {
        this.placed = placed;
        this.overlay?.classList.toggle('vtt-cue-nav-placed', placed);
    }

    private clearPinTimer(): void {
        if (this.pinTimer) { clearTimeout(this.pinTimer); this.pinTimer = null; }
    }

    /** The user started moving the captions: let go of the pin until they stop. */
    suspendPin(): void {
        this.suspended = true;
        this.setPlaced(true);
        this.clearPinTimer();
        this.unpin();
    }

    /**
     * The captions were moved and let go: pin again where they are now. On the
     * next frame, once the final position has been laid out.
     */
    resumePin(): void {
        this.suspended = false;
        requestAnimationFrame(() => {
            if (this.near && !this.suspended && !this.pinned) this.pin();
        });
    }

    private pin(): void {
        if (this.suspended) return;
        const host = this.overlay?.parentElement;
        if (!host || !this.el.isConnected) return;
        const n = this.el.getBoundingClientRect();
        // Not laid out: nothing to pin to, keep following.
        if (n.width === 0 && n.height === 0) return;
        const h = host.getBoundingClientRect();
        this.pinned = { cx: n.left + n.width / 2 - h.left, top: n.top - h.top };
        this.follow();
    }

    private unpin(): void {
        this.pinned = null;
        if (this.followFrame) { cancelAnimationFrame(this.followFrame); this.followFrame = 0; }
        this.el.style.removeProperty('left');
        this.el.style.removeProperty('top');
    }
}
