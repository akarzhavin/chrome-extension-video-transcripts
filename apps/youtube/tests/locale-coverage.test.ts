import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The interface is translated into 54 languages; the word card's parts of
 * speech are not.
 *
 * The card's own texts (loading, error, save, sources) were translated
 * everywhere in 1.0.23. What is left: 51 locales miss exactly the ten
 * part-of-speech labels the card can show, so a reader in one of them sees
 * "noun" or "verb" in English on an otherwise translated card.
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

/** The three locales the parts of speech are translated into. */
const COMPLETE = ['en', 'ru', 'uk'];

/** The ten parts of speech the word card can name. */
const WORD_CARD_KEYS = [
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

/**
 * Keys added to `en` for the popup's per-site highlight switch and the settings
 * page's list of those sites, whose translation into the other locales is done
 * separately. Until then those locales fall back to the English text (Chrome
 * uses `default_locale`).
 *
 * Delete a key from this list in the commit that translates it; delete the list
 * with the last key. Each entry must exist in `en`, so the list cannot outlive
 * a renamed key.
 */
const PENDING_TRANSLATION = [
    'popupHighlightOnSite',
    'popupHighlightOffEverywhere',
    'popupHighlightOffHere',
    'popupManageSites',
    'popupMenuVocabulary',
    'popupMenuWaiting',
    'settingsHighlightOffOn',
    'settingsHighlightOnAgain',
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
            const beyondTheWordCard = missing.filter(
                (k) => !WORD_CARD_KEYS.includes(k) && !PENDING_TRANSLATION.includes(k),
            );
            if (beyondTheWordCard.length) unexpected[locale] = beyondTheWordCard.sort();
        }

        // A locale missing something OTHER than the word card is a different
        // problem from the one this test pins, and would otherwise hide inside
        // the same count.
        expect(unexpected).toEqual({});
    });

    test('every key awaiting translation exists in the English file', () => {
        const english = keysOf('en');
        expect(PENDING_TRANSLATION.filter((k) => !english.has(k))).toEqual([]);
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
            // All ten or none. A locale with some of them would mean a
            // half-translated card, which is worse than a consistently English
            // one and would not show up in a plain count of missing keys.
            if (present.length !== 0) partial[locale] = present.length;
        }

        expect(partial).toEqual({});
    });

    test('the gap is ten keys across 51 locales', () => {
        const all = localeNames();
        expect(all.length).toBe(54);
        expect(all.length - COMPLETE.length).toBe(51);
        // The list itself is this file's literal, so its length compared
        // with ten proved nothing (Principle VII); the three checks above are
        // where the ten keys are load-bearing.
    });
});
