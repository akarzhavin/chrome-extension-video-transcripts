import { computeControlsFloor } from '../src/content/controlsFloor';

const rect = (top: number, bottom: number): DOMRect =>
    ({ top, bottom, height: bottom - top } as DOMRect);

describe('computeControlsFloor', () => {
    test('normal mode: bar top 47px above player bottom → 61px, matching native captions', () => {
        // player 0..720, bar occupies 673..720 (top edge 47px above bottom)
        expect(computeControlsFloor(rect(0, 720), rect(673, 720))).toBe(61);
    });

    test('delhi mode: taller bar → proportionally larger floor', () => {
        // 72px-tall control area → 72 + 14 = 86, YouTube's own delhi margin
        expect(computeControlsFloor(rect(0, 720), rect(648, 720))).toBe(86);
    });

    test('hidden bar (display:none → zero-size rect) is not trusted', () => {
        expect(computeControlsFloor(rect(0, 720), rect(720, 720))).toBeNull();
    });

    test('collapsed player (bot-check error screen) is not trusted', () => {
        expect(computeControlsFloor(rect(0, 0), rect(0, 40))).toBeNull();
    });

    test('bar measuring below the player bottom is not trusted', () => {
        expect(computeControlsFloor(rect(0, 720), rect(750, 800))).toBeNull();
    });
});
