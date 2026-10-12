/**
 * The second subtitle track the server genders "I" and "you" from (T113 in
 * the english repo's specs/023): which one is picked, and how it is aligned.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genderMarked, needsHintModel, secondOrderTable, secondRank, SUPPORTED_LANGUAGES } from '../src/languages';
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
    // Spec 025, User Story 1.
    test.each([
        ['uk', [['ru', 'auto'], ['es', 'manual'], ['tr', 'manual']], 'es'],
        ['fr', [['it', 'manual'], ['ru', 'manual']], 'ru'],
        ['pl', [['ar', 'manual'], ['cs', 'manual']], 'cs'],
        ['ru', [['uk', 'manual'], ['ru', 'manual']], 'ru'],
    ] as const)('target %s among %j: %s', async (target, tracks, want) => {
        const got = await pickSecond(target, source(), tracks.map(([lang, kind]) => candidate(lang, kind, subs(50, lang))));
        expect(got?.sourceLang).toBe(want);
    });

    test('a machine track is never a hint and never loaded: it guesses gender from the same English line', async () => {
        const loaded: string[] = [];
        expect(await pickSecond('uk', source(), [candidate('ru', 'auto', subs(50), loaded), candidate('pl', 'auto', subs(50), loaded)])).toBeNull();
        expect(loaded).toEqual([]);
    });

    test('a track covering less than 80% of the source cues is skipped for the next', async () => {
        const sparse = subs(50, 'Строка').filter((_, i) => i % 10 < 7);
        const got = await pickSecond('uk', source(), [candidate('ru', 'manual', sparse), candidate('pl', 'manual', subs(50, 'Linia'))]);
        expect(got?.sourceLang).toBe('pl');
    });

    test('tracks are tried best first and the first usable one is taken; the same language keeps the site order', async () => {
        const loaded: string[] = [];
        const got = await pickSecond('uk', source(), [
            candidate('fr', 'manual', subs(50), loaded),
            candidate('ru', 'manual', subs(50, 'Первая'), loaded),
            candidate('ru', 'manual', subs(50, 'Вторая'), loaded),
        ]);
        expect(got?.cues[0].text).toBe('Первая 0.');
        expect(loaded).toEqual(['ru/manual']);
    });

    test('at most three tracks are loaded', async () => {
        const loaded: string[] = [];
        const sparse = subs(50).filter((_, i) => i % 2 === 0);
        const got = await pickSecond('uk', source(), ['ru', 'pl', 'cs', 'es'].map((l) => candidate(l, 'manual', sparse, loaded)));
        expect(got).toBeNull();
        expect(loaded).toEqual(['ru/manual', 'pl/manual', 'cs/manual']);
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

    test('genderless targets and hints rank nothing', () => {
        expect([secondRank('ru', 'en'), secondRank('ru', 'de'), secondRank('ru', 'tr'), secondRank('en', 'ru')]).toEqual([0, 0, 0, 0]);
    });

    // fixtures/second-order.txt is a copy of dictionary-service's
    // internal/subtrans/testdata/second-order.txt (spec 025 FR-008).
    test('the order is the server\'s, target by target', () => {
        expect(secondOrderTable()).toBe(readFileSync(resolve(__dirname, 'fixtures/second-order.txt'), 'utf8'));
    });

    test('only a hint the cheap model is not measured to read needs the hint model', () => {
        expect([needsHintModel('uk', 'ru'), needsHintModel('ru', 'ru'), needsHintModel('uk', 'es'), needsHintModel('ru', 'hi')]).toEqual([false, false, true, true]);
    });
});
