/**
 * Which built-in limit a track the extension will not send ran into (english
 * repo spec 032): reported so the admin page sees people hit it.
 */

import { prepareRefusal, prepareTrack } from '../src/subtitle-ai/track';
import type { Subtitle } from '../src/types';

const sub = (start: number, end: number, text: string) => ({ startTime: start, endTime: end, text }) as Subtitle;
const lines = (n: number) => Array.from({ length: n }, (_, i) => sub(i * 2, i * 2 + 1.5, `Line ${i}.`));

describe('prepareRefusal', () => {
    test('a language the backend does not take', () => {
        expect(prepareRefusal(prepareTrack(lines(3), 'xx', 'youtube'), 'xx')).toBe('SUBTITLE_LANGS');
    });

    test('a track past the longest length', () => {
        expect(prepareRefusal(prepareTrack([sub(0, 1, 'Hi.'), sub(5 * 3600, 5 * 3600 + 1, 'Late.')], 'en', 'youtube'), 'en')).toBe(
            'SUBTITLE_MAX_DURATION_MS',
        );
    });

    test('a track read faster than anyone can', () => {
        const dense = Array.from({ length: 40 }, (_, i) => sub(i * 0.4, i * 0.4 + 0.39, 'x'.repeat(19)));
        expect(prepareRefusal(prepareTrack(dense, 'en', 'youtube'), 'en')).toBe('SUBTITLE_MAX_CHARS_PER_SEC');
    });

    test('a track cut at the most lines', () => {
        const p = prepareTrack(lines(4001), 'en', 'youtube');
        expect('error' in p).toBe(false);
        expect(prepareRefusal(p, 'en')).toBe('SUBTITLE_MAX_CUES');
    });

    test('a track that fits, or an empty one, is no limit', () => {
        expect(prepareRefusal(prepareTrack(lines(4000), 'en', 'youtube'), 'en')).toBeNull();
        expect(prepareRefusal(prepareTrack([sub(0, 1, '  ')], 'en', 'youtube'), 'en')).toBeNull();
    });
});
