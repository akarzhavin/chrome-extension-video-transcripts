/**
 * The second subtitle track the server genders "I" and "you" from (T113 in
 * the english repo's specs/023): which one is picked, and how it is aligned.
 */

import { genderMarked, secondRank, SUPPORTED_LANGUAGES } from '../src/languages';
import { align, coverage, pickSecond, type SecondCandidate } from '../src/subtitle-ai/second';
import { prepareTrack, type PreparedTrack } from '../src/subtitle-ai/track';
import type { Subtitle } from '../src/types';

// n cues of 2 s, a cue every 2 s.
const subs = (n: number, word = 'Line'): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `${word} ${i}.` }));

const source = (n = 50): PreparedTrack => {
    const p = prepareTrack(subs(n), 'en', 'youtube');
    if ('error' in p) throw new Error(p.error);
    return p;
};

const candidate = (lang: string, kind: 'manual' | 'auto', s: Subtitle[], loaded: string[] = []): SecondCandidate => ({
    lang,
    kind,
    load: async () => {
        loaded.push(`${lang}/${kind}`);
        return s;
    },
});

describe('picking the second track', () => {
    test('target ru with es manual and ru auto-translated: es, a human track beats any machine one', async () => {
        const got = await pickSecond('ru', source(), [candidate('ru', 'auto', subs(50, 'Строка')), candidate('es', 'manual', subs(50, 'Línea'))]);
        expect(got?.sourceLang).toBe('es');
    });

    test('target ru with ru manual and uk manual: ru, the target language first', async () => {
        const got = await pickSecond('ru', source(), [candidate('uk', 'manual', subs(50, 'Рядок')), candidate('ru', 'manual', subs(50, 'Строка'))]);
        expect(got?.sourceLang).toBe('ru');
    });

    test('a track covering less than 80% of the source cues is skipped for the next', async () => {
        const sparse = subs(50, 'Строка').filter((_, i) => i % 10 < 7);
        const got = await pickSecond('ru', source(), [candidate('ru', 'manual', sparse), candidate('pl', 'manual', subs(50, 'Linia'))]);
        expect(got?.sourceLang).toBe('pl');
    });

    test('within a rank the fuller track, then the site order', async () => {
        const most = subs(50, 'Строка').filter((_, i) => i % 10 !== 0); // 90%
        expect((await pickSecond('ru', source(), [candidate('ru', 'manual', most), candidate('ru', 'manual', subs(50, 'Фраза'))]))?.cues[0].text).toBe('Фраза 0.');
        expect((await pickSecond('ru', source(), [candidate('ru', 'manual', subs(50, 'Первая')), candidate('ru', 'manual', subs(50, 'Вторая'))]))?.cues[0].text).toBe('Первая 0.');
    });

    test('only the best rank is loaded when it has a usable track', async () => {
        const loaded: string[] = [];
        await pickSecond('ru', source(), [candidate('es', 'auto', subs(50), loaded), candidate('uk', 'manual', subs(50), loaded), candidate('fr', 'manual', subs(50), loaded)]);
        expect(loaded).toEqual(['uk/manual']);
    });

    test('a target that shows no gender of "I" and "you" loads nothing', async () => {
        for (const target of ['en', 'zh', 'de']) {
            const loaded: string[] = [];
            expect(await pickSecond(target, source(), [candidate('es', 'manual', subs(50), loaded)])).toBeNull();
            expect(loaded).toEqual([]);
        }
    });
});

describe('aligning by time', () => {
    test('a cue split in two in the second track still pairs with its source cue, and every later cue with its own', () => {
        const src = source(10).cues;
        const second = subs(10, 'es').flatMap((s, i) =>
            i === 3
                ? [{ ...s, endTime: s.startTime + 0.75, text: 'es 3a' }, { ...s, startTime: s.startTime + 0.75, text: 'es 3b' }]
                : [s],
        ).map((s) => ({ start_ms: s.startTime * 1000, end_ms: s.endTime * 1000, text: s.text }));
        const al = align(src, second);
        const text = (i: number) => al[i].map((j) => second[j].text).join(' ');
        expect([text(2), text(3), text(4), text(9)]).toEqual(['es 2.', 'es 3a es 3b', 'es 4.', 'es 9.']);
        expect(coverage(src, al)).toBe(1);
    });
});

describe('languages', () => {
    test('22 of the 42 target languages show the gender of "I" or "you"', () => {
        const marked = SUPPORTED_LANGUAGES.filter((l) => genderMarked(l.code)).map((l) => l.code);
        expect(SUPPORTED_LANGUAGES).toHaveLength(42);
        expect(marked.sort()).toEqual(
            ['ru', 'uk', 'pl', 'cs', 'sk', 'sl', 'sr', 'hr', 'hi', 'he', 'ar', 'th', 'vi', 'es', 'pt', 'it', 'fr', 'ro', 'el', 'bg', 'lv', 'lt'].sort(),
        );
    });

    test('the ranks match the server: the target, close strong, any strong, close adjective, any adjective', () => {
        expect(['ru', 'uk', 'he', 'bg', 'es'].map((l) => secondRank('ru', l))).toEqual([1, 2, 3, 4, 5]);
        expect(['he', 'ar', 'ru', 'es'].map((l) => secondRank('he', l))).toEqual([1, 2, 3, 5]);
        expect(['es', 'ru', 'pt', 'lv'].map((l) => secondRank('es', l))).toEqual([1, 3, 4, 5]);
        expect([secondRank('ru', 'en'), secondRank('ru', 'de'), secondRank('en', 'ru')]).toEqual([0, 0, 0]);
    });
});
