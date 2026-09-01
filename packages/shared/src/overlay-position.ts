// Where the viewer put the captions, and where they can actually be drawn right
// now. Those are two different numbers, and conflating them is what made the
// position collapse on its own: the clamp was written back over the stored
// value, so one long cue — or one moment before layout — permanently rewrote
// what the user had chosen, and nothing ever restored it. The block shrinks
// again on the next cue, but the intent is gone.
//
// So intent is held exactly as the user left it and is only ever changed by the
// user. The bound is a projection applied at paint time, recomputed from live
// geometry on every render. A caption pushed to the middle by a wrapped
// three-line cue rides back out to the edge when the next cue is short.

import type { OverlayLevelToken } from './prefs';

// Share of the PLAYER HEIGHT, not px: the presets were tuned as 40/80/140px on a
// fullscreen 1080p frame, and these are those same values as a fraction of it —
// which is what keeps "medium" at the same place on the small inline player
// instead of climbing to a fifth of the frame. Numbers, not strings, because
// the clamp below does arithmetic on them; applyOverlayStyle adds the unit.
export const OVERLAY_BOTTOM_PCT: Record<OverlayLevelToken, number> = {
    low: 3.7,
    medium: 7.4,
    high: 13,
};

/** Bounds a stored nudge is checked against on the way in — see below. */
export interface NudgeRange {
    min: number;
    max: number;
}

// The range a nudge can actually be WRITTEN in. Intent only ever changes
// through set()/nudgeBy(), and both clamp, so a stored value outside these
// bounds was not produced by a drag or an arrow key — it is a leftover from a
// build that computed the number differently, or a corrupt blob. prefs.ts
// treats such a value as absent rather than pulling it to the nearest bound:
// pulled in, it still paints the caption at the very top of the frame, which
// is what happened on Netflix when a 108 (written by a pre-clamp dev build)
// was read back as 108% and clamped to 100.
//
// Derived from clampBottom/clampInline with the widest metrics they accept —
// overlay-position.test.ts checks the formulas never leave these bounds, so a
// change to a margin or a preset that widens them fails there, not in the
// field. Vertical: the ceiling is 100 − lowest preset (3.7) − VERTICAL_MARGIN
// (2.5) − the block, so < 93.8; the floor is −(highest preset (13) − 2.5) =
// −10.5. Horizontal: |v| < 50 − HORIZONTAL_MARGIN (4) = 46.
export const BOTTOM_NUDGE_RANGE: NudgeRange = { min: -11, max: 94 };
export const INLINE_NUDGE_RANGE: NudgeRange = { min: -46, max: 46 };

/** The player geometry a clamp is measured against, sampled at paint time. */
export interface OverlayMetrics {
    /** Player height in px, or 0 when it cannot be measured (pre-layout, jsdom). */
    playerHeight: number;
    /** Player width in px, or 0 when it cannot be measured. */
    playerWidth: number;
    /** Caption block height in px, or 0 when unmeasurable. */
    blockHeight: number;
    /** Widest caption row in px, or 0 when unmeasurable. */
    blockWidth: number;
    /** The bottom preset (low/medium/high) as a share of the player height. */
    presetPct: number;
}

// Clearance kept at the top of the frame, as a share of the height.
const VERTICAL_MARGIN_PCT = 2.5;
// 4% of the width, not 1: measured on a 1205px player, a short caption is narrow
// enough that a 1% margin let it travel until its edge sat 20px from the
// frame's — technically inside the picture, and visibly wrong. Native captions
// never touch the edge either.
const HORIZONTAL_MARGIN_PCT = 4;
// Block-size fallbacks for the tick before layout (and jsdom, which has none).
// Deliberately generous: erring large costs a little reach at the extremes,
// erring small is what puts the caption off-screen.
const FALLBACK_BLOCK_H_PCT = 22;
// .vtt-overlay-main's max-width — the widest a caption can legally get.
const FALLBACK_BLOCK_W_PCT = 80;

/** Two decimals: fine enough that a 1px move on a 1080p frame (0.09%) survives,
 *  coarse enough that prefs do not fill with float noise. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * The caption's position in both axes: the viewer's intent, plus the clamped
 * values that are safe to paint against the current geometry.
 *
 * Intent changes ONLY through set/nudgeBy — i.e. only when the user drags or
 * presses an arrow. Rendering never writes back.
 */
export class OverlayPosition {
    // As the user left it. Survives a cue that is briefly too tall to honour it.
    private bottomIntent = 0;
    private inlineIntent = 0;

    constructor(bottom = 0, inline = 0) {
        this.bottomIntent = bottom;
        this.inlineIntent = inline;
    }

    /** The stored values — what belongs in prefs. Never the clamped ones. */
    get bottom(): number {
        return this.bottomIntent;
    }
    get inline(): number {
        return this.inlineIntent;
    }

    /** Adopt values loaded from prefs. Not a user edit, so nothing is persisted. */
    load(bottom: number, inline: number): void {
        this.bottomIntent = bottom;
        this.inlineIntent = inline;
    }

    /**
     * A user edit: move to an absolute position, bounded by what currently fits.
     * The clamp is applied to intent here — and only here — because the user is
     * looking at the result, so the bound is part of what they chose.
     */
    set(m: OverlayMetrics, bottom: number, inline: number): void {
        this.bottomIntent = clampBottom(m, bottom);
        this.inlineIntent = clampInline(m, inline);
    }

    /** A user edit by a delta, for the arrow keys. */
    nudgeBy(m: OverlayMetrics, dBottom: number, dInline: number): void {
        this.set(m, this.bottomIntent + dBottom, this.inlineIntent + dInline);
    }

    /**
     * What to paint right now: intent, pulled inside the frame if it does not
     * currently fit. Pure — call it as often as you render.
     */
    resolve(m: OverlayMetrics): { bottom: number; inline: number } {
        return {
            bottom: clampBottom(m, this.bottomIntent),
            inline: clampInline(m, this.inlineIntent),
        };
    }
}

/**
 * Keep the caption inside the player vertically. Without this the block can be
 * pushed off the top of the frame, where there is nothing to grab it by — the
 * grip has gone with it, and the only way back is the settings panel.
 *
 * The ceiling is measured against the caption's TOP edge, not its bottom.
 * `bottom` positions the block's lower edge, so a bound that only looked at that
 * let the block itself keep going: at bottom 77% a two-line dual caption (~20%
 * of the frame) has its top at 97%, and the rest is off the top of the player.
 */
export function clampBottom(m: OverlayMetrics, next: number): number {
    const blockPct =
        m.playerHeight && m.blockHeight
            ? (m.blockHeight / m.playerHeight) * 100
            : FALLBACK_BLOCK_H_PCT;
    const maxUp = Math.max(0, 100 - m.presetPct - blockPct - VERTICAL_MARGIN_PCT);
    const maxDown = Math.max(0, m.presetPct - VERTICAL_MARGIN_PCT);
    return round2(Math.min(maxUp, Math.max(-maxDown, next)));
}

/**
 * The horizontal mirror. The geometry differs, though: the block starts CENTRED,
 * so the room on either side is half of what the caption does not already
 * occupy — a caption filling 60% of the width can travel 20% before its edge
 * reaches the frame's, not 100%.
 */
export function clampInline(m: OverlayMetrics, next: number): number {
    const blockPct =
        m.playerWidth && m.blockWidth
            ? (m.blockWidth / m.playerWidth) * 100
            : FALLBACK_BLOCK_W_PCT;
    const room = Math.max(0, (100 - blockPct) / 2 - HORIZONTAL_MARGIN_PCT);
    return round2(Math.min(room, Math.max(-room, next)));
}
