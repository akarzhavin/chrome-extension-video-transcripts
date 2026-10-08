import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The interface is translated into 54 languages, every key in every one.
 *
 * Until 1.0.25 the word card's ten part-of-speech labels were translated only
 * into en, ru and uk, so a reader elsewhere saw "noun" or "verb" in English on
 * an otherwise translated card. They are translated everywhere now, and this
 * keeps it that way: a key added to `en` and not to the other locales fails
 * here.
 *
 * A unit test rather than a live one on purpose: it compares files, so a
 * browser would add four minutes and nothing else.
 */

const LOCALES_DIR = join(__dirname, '..', '_locales');

const localeNames = (): string[] =>
    readdirSync(LOCALES_DIR).filter((d) => existsSync(join(LOCALES_DIR, d, 'messages.json')));

const keysOf = (locale: string): Set<string> =>
    new Set(Object.keys(JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8'))));

describe('translation coverage', () => {
    test('there are 54 locales', () => {
        expect(localeNames()).toHaveLength(54);
    });

    test('every locale carries every key of en', () => {
        const reference = keysOf('en');
        const missing: Record<string, string[]> = {};

        for (const locale of localeNames()) {
            const own = keysOf(locale);
            const gaps = [...reference].filter((k) => !own.has(k)).sort();
            if (gaps.length) missing[locale] = gaps;
        }

        expect(missing).toEqual({});
    });

    // The ten labels the word card can show, named here so a rename in `en`
    // alone cannot make the check above pass by dropping them from every file.
    test('the word card part-of-speech labels are in every locale', () => {
        const labels = [
            'ytPosAdj',
            'ytPosAdv',
            'ytPosConj',
            'ytPosIntj',
            'ytPosNoun',
            'ytPosNum',
            'ytPosPhrase',
            'ytPosPrep',
            'ytPosPron',
            'ytPosVerb',
        ];
        const without = localeNames().filter((l) => labels.some((k) => !keysOf(l).has(k)));
        expect(without).toEqual([]);
    });
});
