import { pairSecondaryToMain } from '../src/track-pairing';
import { Subtitle } from '../src/types';

const cue = (text: string, startTime: number, endTime: number): Subtitle => ({ text, startTime, endTime });

describe('pairSecondaryToMain', () => {
    // The Netflix shape that produced the duplicates: the translation is cut
    // by its own translator and runs a few hundred ms behind the original, so
    // every translated cue straddles two original ones.
    test('a translation cue shifted across two lines goes under the one it mostly covers', () => {
        const main = [cue('A', 0, 2), cue('B', 2, 4), cue('C', 4, 6)];
        const secondary = [cue('a', 0.3, 2.4), cue('b', 2.4, 4.3), cue('c', 4.3, 6.1)];
        expect(pairSecondaryToMain(main, secondary).map((p) => p.map((s) => s.text))).toEqual([
            ['a'],
            ['b'],
            ['c'],
        ]);
    });

    test('no translation cue is assigned twice', () => {
        const main = [cue('A', 0, 2), cue('B', 2, 4), cue('C', 4, 6)];
        const secondary = [cue('a', 0.3, 2.4), cue('b', 2.4, 4.3), cue('c', 4.3, 6.1)];
        const seen = pairSecondaryToMain(main, secondary).flat();
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toHaveLength(secondary.length);
    });

    test('two translation cues inside one line are both kept, in time order', () => {
        const main = [cue('A', 0, 10)];
        const secondary = [cue('second', 5, 8), cue('first', 1, 4)];
        expect(pairSecondaryToMain(main, secondary)[0].map((s) => s.text)).toEqual(['first', 'second']);
    });

    test('a translation cue that touches no line is dropped, not forced onto a neighbour', () => {
        const main = [cue('A', 0, 2), cue('B', 10, 12)];
        const secondary = [cue('gap', 4, 6)];
        expect(pairSecondaryToMain(main, secondary)).toEqual([[], []]);
    });

    test('touching edges are not overlap', () => {
        // The old any-overlap rule already treated a shared boundary as no
        // overlap; the assignment keeps that, so a cue ending exactly where
        // the next line starts stays with the line it is inside.
        const main = [cue('A', 0, 5), cue('B', 5, 10)];
        const secondary = [cue('a', 3, 5), cue('b', 5, 7)];
        expect(pairSecondaryToMain(main, secondary).map((p) => p.map((s) => s.text))).toEqual([['a'], ['b']]);
    });

    test('an exact tie goes to the earlier line', () => {
        const main = [cue('A', 0, 4), cue('B', 4, 8)];
        const secondary = [cue('even', 2, 6)];
        expect(pairSecondaryToMain(main, secondary).map((p) => p.map((s) => s.text))).toEqual([['even'], []]);
    });

    test('a line fully inside a long translation cue still gets it — once', () => {
        const main = [cue('A', 0, 1), cue('B', 1, 9), cue('C', 9, 10)];
        const secondary = [cue('long', 0.5, 9.5)];
        expect(pairSecondaryToMain(main, secondary).map((p) => p.map((s) => s.text))).toEqual([[], ['long'], []]);
    });

    test('identical segmentation pairs one-to-one, so aligned tracks are unchanged', () => {
        const main = [cue('A', 0, 2), cue('B', 2, 4), cue('C', 4.5, 6)];
        const secondary = [cue('a', 0, 2), cue('b', 2, 4), cue('c', 4.5, 6)];
        expect(pairSecondaryToMain(main, secondary).map((p) => p.map((s) => s.text))).toEqual([
            ['a'],
            ['b'],
            ['c'],
        ]);
    });

    test('empty inputs', () => {
        expect(pairSecondaryToMain([], [cue('a', 0, 1)])).toEqual([]);
        expect(pairSecondaryToMain([cue('A', 0, 1)], [])).toEqual([[]]);
    });

    test('agrees with brute force on random tracks: each cue to its best line, at most once', () => {
        // The sweep keeps a moving lower bound over `main`; this checks the
        // bound never skips a line that would have scored better.
        let seed = 7;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let round = 0; round < 200; round++) {
            const make = (n: number, prefix: string): Subtitle[] => {
                const out: Subtitle[] = [];
                let t = rnd() * 3;
                for (let i = 0; i < n; i++) {
                    const len = 0.2 + rnd() * 4;
                    out.push(cue(`${prefix}${i}`, t, t + len));
                    // Occasional overlap between consecutive cues of the same track.
                    t += len * (0.6 + rnd() * 0.8);
                }
                return out;
            };
            const main = make(1 + Math.floor(rnd() * 12), 'm');
            const secondary = make(1 + Math.floor(rnd() * 12), 's');

            const expected: Subtitle[][] = main.map(() => []);
            for (const s of secondary) {
                let best = -1;
                let bestOverlap = 0;
                main.forEach((m, j) => {
                    const overlap = Math.min(m.endTime, s.endTime) - Math.max(m.startTime, s.startTime);
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        best = j;
                    }
                });
                if (best >= 0) expected[best].push(s);
            }
            expect(pairSecondaryToMain(main, secondary)).toEqual(expected);
        }
    });
});
