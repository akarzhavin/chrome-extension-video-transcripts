import { parseJson3 } from '../src/content/json3';

/** An event in the shape YouTube actually sends (captured over CDP). */
const ev = (tStartMs: number, dDurationMs: number, text: string) => ({
    tStartMs, dDurationMs,
    wpWinPosId: 1, wsWinStyleId: 1,
    segs: [{ utf8: text }],
});

describe('parseJson3', () => {
    test('parses plain cues', () => {
        const json = JSON.stringify({ events: [ev(1000, 2000, 'Hello'), ev(4000, 1000, 'World')] });
        expect(parseJson3(json)).toEqual([
            { startTime: 1, endTime: 3, text: 'Hello' },
            { startTime: 4, endTime: 5, text: 'World' },
        ]);
    });

    // The real defect: some tracks send EVERY event twice, byte-identical.
    // Measured on watch?v=Qtl8lJwbd4g — 1612 events, 806 distinct start times.
    // Nothing in the payload distinguishes the copies, so the parser is the
    // only place this can be caught.
    test('collapses events YouTube sends twice', () => {
        const json = JSON.stringify({
            events: [
                ev(201, 1633, 'BEHIND ME are ONE HUNDRED cops,'),
                ev(201, 1633, 'BEHIND ME are ONE HUNDRED cops,'),
                ev(1901, 2033, 'and if they arrest us'),
                ev(1901, 2033, 'and if they arrest us'),
            ],
        });
        const subs = parseJson3(json);
        expect(subs.map((s) => s.text)).toEqual([
            'BEHIND ME are ONE HUNDRED cops,',
            'and if they arrest us',
        ]);
    });

    test('collapses runs longer than two', () => {
        const json = JSON.stringify({ events: [
            ev(100, 500, 'Same'), ev(100, 500, 'Same'), ev(100, 500, 'Same'),
            ev(900, 500, 'Next'),
        ] });
        expect(parseJson3(json).map((s) => s.text)).toEqual(['Same', 'Next']);
    });

    // Dedup must run BEFORE the overlap cap. Capping first rewrites the first
    // copy's endTime to its twin's identical startTime, so the two stop
    // comparing equal and the duplicate survives.
    test('dedups overlapping duplicates (order of operations)', () => {
        const json = JSON.stringify({ events: [
            ev(1000, 5000, 'Overlaps the next one'),
            ev(1000, 5000, 'Overlaps the next one'),
            ev(2000, 1000, 'Later'),
        ] });
        const subs = parseJson3(json);
        expect(subs).toHaveLength(2);
        expect(subs[0].text).toBe('Overlaps the next one');
        // ...and the cap still applies to what survives.
        expect(subs[0].endTime).toBeCloseTo(1.999, 3);
    });

    test('keeps same text at DIFFERENT times (a genuine repeat in the video)', () => {
        const json = JSON.stringify({ events: [ev(1000, 500, 'All right.'), ev(9000, 500, 'All right.')] });
        expect(parseJson3(json)).toHaveLength(2);
    });

    test('caps overlapping cues to the next start', () => {
        const json = JSON.stringify({ events: [ev(1000, 5000, 'Long'), ev(2000, 1000, 'Next')] });
        const subs = parseJson3(json);
        expect(subs[0].endTime).toBeCloseTo(1.999, 3);
    });

    test('survives malformed input', () => {
        expect(parseJson3('')).toEqual([]);
        expect(parseJson3('not json')).toEqual([]);
        expect(parseJson3('{}')).toEqual([]);
    });
});
