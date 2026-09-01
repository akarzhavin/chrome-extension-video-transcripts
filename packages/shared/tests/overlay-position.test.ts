import {
    clampBottom,
    clampInline,
    OverlayMetrics,
    OVERLAY_BOTTOM_PCT,
    BOTTOM_NUDGE_RANGE,
    INLINE_NUDGE_RANGE,
} from '../src/overlay-position';

// prefs.ts drops a stored nudge outside BOTTOM_NUDGE_RANGE/INLINE_NUDGE_RANGE
// as "never written by a drag". That is only true while the clamps cannot
// produce such a value — so this pins the ranges to the formulas: widen a
// margin or add a preset and the bound has to move with it, here, on purpose.
describe('nudge ranges cover everything the clamps can write', () => {
    const presets = Object.values(OVERLAY_BOTTOM_PCT);
    const players = [0, 120, 360, 962, 1080, 2160];
    const blocks = [0, 10, 40, 88, 240, 600, 3000];
    const inputs = [-1e6, -100, -10.5, -1, 0, 1, 50, 89.5, 94, 100, 108, 1e6, Number.MAX_SAFE_INTEGER];

    test('clampBottom never leaves BOTTOM_NUDGE_RANGE', () => {
        for (const presetPct of presets) {
            for (const playerHeight of players) {
                for (const blockHeight of blocks) {
                    const m: OverlayMetrics = { playerHeight, playerWidth: 0, blockHeight, blockWidth: 0, presetPct };
                    for (const next of inputs) {
                        const out = clampBottom(m, next);
                        expect(out).toBeGreaterThanOrEqual(BOTTOM_NUDGE_RANGE.min);
                        expect(out).toBeLessThanOrEqual(BOTTOM_NUDGE_RANGE.max);
                    }
                }
            }
        }
    });

    test('clampInline never leaves INLINE_NUDGE_RANGE', () => {
        for (const playerWidth of [0, 320, 1408, 1920, 3840]) {
            for (const blockWidth of blocks) {
                const m: OverlayMetrics = { playerHeight: 0, playerWidth, blockHeight: 0, blockWidth, presetPct: 7.4 };
                for (const next of inputs) {
                    const out = clampInline(m, next);
                    expect(out).toBeGreaterThanOrEqual(INLINE_NUDGE_RANGE.min);
                    expect(out).toBeLessThanOrEqual(INLINE_NUDGE_RANGE.max);
                }
            }
        }
    });

    test('the ranges are tight enough that a real edge position is not mistaken for garbage', () => {
        // A one-line caption on the low preset, dragged as high as it goes, on
        // a 962px Netflix player — the reachable maximum is inside the range by
        // a margin small enough that the range is not just "anything".
        const m: OverlayMetrics = { playerHeight: 962, playerWidth: 1408, blockHeight: 40, blockWidth: 120, presetPct: OVERLAY_BOTTOM_PCT.low };
        const top = clampBottom(m, 1e6);
        expect(top).toBeGreaterThan(85);
        expect(top).toBeLessThanOrEqual(BOTTOM_NUDGE_RANGE.max);
        const side = clampInline(m, 1e6);
        expect(side).toBeGreaterThan(40);
        expect(side).toBeLessThanOrEqual(INLINE_NUDGE_RANGE.max);
    });
});
