import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The interface is translated into 54 languages; the word card is not.
 *
 * 51 of those locales are missing exactly the 18 pieces of text that make up
 * the word card, so a reader in one of them gets a fully translated sidebar and
 * then drops into English on the product's central learning surface, with no
 * error and nothing to indicate it.
 *
 * This pins the gap rather than fixing it — the fix is a product decision. What
 * the test buys is that the gap cannot change size unnoticed, in either
 * direction: translating one of these keys, or dropping a new key from the
 * translated locales, both move the count and fail here.
 *
 * A unit test rather than a live one on purpose: it compares files, so a
 * browser would add four minutes and nothing else.
 */

const LOCALES_DIR = join(__dirname, '..', '_locales');

/** The three locales the word card is translated into. */
const COMPLETE = ['en', 'ru', 'uk'];

/**
 * The word card's own text: its loading and error states, its save control, the
 * two source labels, and the ten parts of speech it can name.
 */
const WORD_CARD_KEYS = [
    'ytLookupError',
    'ytLookupLoading',
    'ytLookupMore',
    'ytLookupNone',
    'ytLookupSave',
    'ytLookupSaved',
    'ytLookupSrcAi',
    'ytLookupSrcDict',
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

const localeNames = (): string[] =>
    readdirSync(LOCALES_DIR).filter((d) => existsSync(join(LOCALES_DIR, d, 'messages.json')));

const keysOf = (locale: string): Set<string> =>
    new Set(Object.keys(JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8'))));

describe('word-card translation coverage', () => {
    test('every locale carries the same keys except the word card', () => {
        const reference = keysOf('en');
        const unexpected: Record<string, string[]> = {};

        for (const locale of localeNames()) {
            const missing = [...reference].filter((k) => !keysOf(locale).has(k));
            const beyondTheWordCard = missing.filter((k) => !WORD_CARD_KEYS.includes(k));
            if (beyondTheWordCard.length) unexpected[locale] = beyondTheWordCard.sort();
        }

        // A locale missing something OTHER than the word card is a different
        // problem from the one this test pins, and would otherwise hide inside
        // the same count.
        expect(unexpected).toEqual({});
    });

    test('the word card is translated in exactly three locales', () => {
        const translated = localeNames()
            .filter((l) => WORD_CARD_KEYS.every((k) => keysOf(l).has(k)))
            .sort();

        expect(translated).toEqual([...COMPLETE].sort());
    });

    test('every other locale is missing the word card entirely, not partly', () => {
        const partial: Record<string, number> = {};

        for (const locale of localeNames()) {
            if (COMPLETE.includes(locale)) continue;
            const present = WORD_CARD_KEYS.filter((k) => keysOf(locale).has(k));
            // All 18 or none. A locale with some of them would mean a
            // half-translated card, which is worse than a consistently English
            // one and would not show up in a plain count of missing keys.
            if (present.length !== 0) partial[locale] = present.length;
        }

        expect(partial).toEqual({});
    });

    test('the gap is 18 keys across 51 locales', () => {
        const all = localeNames();
        expect(all.length).toBe(54);
        expect(all.length - COMPLETE.length).toBe(51);
        // The list itself is this file's literal, so its length compared
        // with 18 proved nothing (Principle VII); the three checks above are
        // where the 18 keys are load-bearing.
    });
});
