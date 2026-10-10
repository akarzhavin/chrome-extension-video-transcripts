/**
 * Server-side subtitle translation (english repo, spec 023): the track the
 * extension stores and the fingerprint it is stored under.
 *
 * The fingerprint is checked only against the golden vectors the Go backend
 * generated: if the two sides disagree by one byte, the backend discards the
 * track as forged and translation silently never starts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fingerprint, prepareTrack, type WireCue } from '../src/subtitle-ai/track';

interface Vector {
    name: string;
    source_lang: string;
    cues: [number, number, string][];
    fingerprint: string;
    /** The site's text before cleaning; the cues carry what is hashed. */
    raw?: string[];
}

// A copy of the backend's vectors (english repo,
// services/dictionary-service/internal/subtrans/testdata/fingerprint-vectors.json),
// so this suite never depends on another checkout's path (T063).
const VECTORS_FILE = resolve(__dirname, 'fixtures/subtitle-fingerprint-vectors.json');

function loadVectors(path: string): Vector[] {
    return (JSON.parse(readFileSync(path, 'utf8')) as { vectors: Vector[] }).vectors;
}

const VECTORS = loadVectors(VECTORS_FILE);
const sub = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text });

describe('fingerprint', () => {
    test('the vectors were found', () => {
        expect(VECTORS.length).toBeGreaterThan(3);
    });

    // The copy drifting from the backend's would make the check pass on stale
    // vectors; compared whenever the backend's file is given or beside us.
    test('the copy matches the backend\'s vectors, where they can be read', () => {
        const backend = process.env.LINGOGRAM_SUBTITLE_VECTORS_PATH
            ?? resolve(__dirname, '../../../../../english/services/dictionary-service/internal/subtrans/testdata/fingerprint-vectors.json');
        if (!existsSync(backend)) return;
        expect(loadVectors(VECTORS_FILE)).toEqual(loadVectors(backend));
    });

    test.each(VECTORS)('$name', (v) => {
        const cues: WireCue[] = v.cues.map(([start_ms, end_ms, text]) => ({ start_ms, end_ms, text }));
        expect(fingerprint(v.source_lang, cues)).toBe(v.fingerprint);
    });

    // T055: the cleaned text is what is hashed, so cleaning is part of the contract.
    test('raw site text cleans into the vector and its fingerprint', () => {
        const withRaw = VECTORS.filter((v) => v.raw);
        expect(withRaw.length).toBeGreaterThan(0);
        for (const v of withRaw) {
            const r = prepareTrack(v.raw!.map((text, i) => sub(v.cues[i][0] / 1000, v.cues[i][1] / 1000, text)), v.source_lang, 'rezka');
            if ('error' in r) throw new Error(r.error);
            expect(r.cues.map((c) => c.text)).toEqual(v.cues.map((c) => c[2]));
            expect(r.fingerprint).toBe(v.fingerprint);
        }
    });
});

describe('prepareTrack', () => {
    test('cleans text the way the backend expects it: no tags, no line breaks, NFC', () => {
        const r = prepareTrack([sub(1, 3, '<i>Café</i>\nis <font color="red">open</font>')], 'en', 'rezka');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues).toEqual([{ start_ms: 1000, end_ms: 3000, text: 'Café is open' }]);
        expect(r.index).toEqual([0]);
        expect(r.durationMs).toBe(3000);
    });

    test('leaves out cues the backend would refuse, and remembers where the rest came from', () => {
        const r = prepareTrack([
            sub(0, 2, 'Kept.'),
            sub(2, 2.2, 'Too short.'),            // under 300 ms
            sub(3, 3.5, 'x'.repeat(13)),          // 26 cps: a short line said fast, kept
            sub(3.6, 4.1, 'z'.repeat(26)),        // 52 cps
            sub(4, 6, ''),                        // nothing to translate
            sub(5, 7, 'Also kept.'),
            sub(4.9, 8, 'Starts before the previous one.'),
            sub(8, 30, 'y'.repeat(501)),          // over 500 characters
            sub(9, 11, 'Last.'),
        ], 'en', 'youtube');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues.map((c) => c.text)).toEqual(['Kept.', 'x'.repeat(13), 'Also kept.', 'Last.']);
        expect(r.index).toEqual([0, 2, 5, 8]);
    });

    test('ASS override blocks are stripped like tags; other braces stay', () => {
        const r = prepareTrack([sub(0, 2, '{\\an8}Up {\\i1}here{\\i0}, {not a block}')], 'en', 'rezka');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues[0].text).toBe('Up here, {not a block}');
    });

    test('control and invisible characters are removed, not sent', () => {
        const r = prepareTrack([sub(0, 2, 'right‮left\u0007')], 'en', 'netflix');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues[0].text).toBe('rightleft');
    });

    test('refuses a language or site the backend does not take', () => {
        expect(prepareTrack([sub(0, 2, 'Hi.')], 'xx', 'rezka')).toEqual({ error: 'unsupported' });
        expect(prepareTrack([sub(0, 2, 'Hi.')], 'en', 'other')).toEqual({ error: 'unsupported' });
    });

    test('nothing translatable is an error, not an empty track', () => {
        expect(prepareTrack([sub(0, 2, '')], 'en', 'rezka')).toEqual({ error: 'empty' });
    });

    test('a track over four hours is refused', () => {
        expect(prepareTrack([sub(0, 2, 'a'), sub(14400, 14402, 'b')], 'en', 'rezka')).toEqual({ error: 'too_long' });
    });

    test('keeps at most 4000 cues', () => {
        const many = Array.from({ length: 4100 }, (_, i) => sub(i * 2, i * 2 + 1, `L${i}`));
        const r = prepareTrack(many, 'en', 'rezka');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues).toHaveLength(4000);
        expect(r.index[3999]).toBe(3999);
    });

    test('a track that reads faster than 25 characters a second overall is refused', () => {
        // Each cue alone is under 25 cps; stacked on one second they are not.
        const stacked = Array.from({ length: 5 }, () => sub(0, 1, 'x'.repeat(20)));
        expect(prepareTrack(stacked, 'en', 'rezka')).toEqual({ error: 'too_dense' });
    });

    test('the fingerprint covers exactly the cues that are sent', () => {
        const r = prepareTrack([sub(0, 1, 'Hello.')], 'en', 'rezka');
        if ('error' in r) throw new Error(r.error);
        expect(r.fingerprint).toBe(VECTORS.find((v) => v.name === 'one cue')!.fingerprint);
    });
});
