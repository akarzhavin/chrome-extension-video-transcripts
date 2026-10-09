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
}

const VECTORS_REL = 'services/dictionary-service/internal/subtrans/testdata/fingerprint-vectors.json';

// No built-in fallback: a vector check that quietly finds nothing checks nothing.
function loadVectors(): Vector[] {
    const workspace = resolve(__dirname, '../../../../..');
    const tried = [
        ...(process.env.LINGOGRAM_SUBTITLE_VECTORS_PATH ? [process.env.LINGOGRAM_SUBTITLE_VECTORS_PATH] : []),
        resolve(workspace, 'english', VECTORS_REL),
        resolve(workspace, 'english/.claude/worktrees/023-subtitle-auto-translate', VECTORS_REL),
    ];
    const found = tried.find((p) => existsSync(p));
    if (!found) throw new Error(`fingerprint vectors not found; tried:\n  ${tried.join('\n  ')}`);
    return (JSON.parse(readFileSync(found, 'utf8')) as { vectors: Vector[] }).vectors;
}

const VECTORS = loadVectors();
const sub = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text });

describe('fingerprint', () => {
    test('the vectors were found', () => {
        expect(VECTORS.length).toBeGreaterThan(3);
    });

    test.each(VECTORS)('$name', (v) => {
        const cues: WireCue[] = v.cues.map(([start_ms, end_ms, text]) => ({ start_ms, end_ms, text }));
        expect(fingerprint(v.source_lang, cues)).toBe(v.fingerprint);
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
            sub(3, 3.5, 'x'.repeat(13)),          // 26 cps
            sub(4, 6, ''),                        // nothing to translate
            sub(5, 7, 'Also kept.'),
            sub(4.9, 8, 'Starts before the previous one.'),
            sub(8, 30, 'y'.repeat(501)),          // over 500 characters
            sub(9, 11, 'Last.'),
        ], 'en', 'youtube');
        if ('error' in r) throw new Error(r.error);
        expect(r.cues.map((c) => c.text)).toEqual(['Kept.', 'Also kept.', 'Last.']);
        expect(r.index).toEqual([0, 4, 7]);
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
