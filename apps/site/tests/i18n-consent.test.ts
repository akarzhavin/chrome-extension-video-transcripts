/**
 * Consent banner strings, across every locale.
 *
 * build.mjs already refuses to build when a locale's key set drifts from
 * en.json (its parity check throws, and makeT throws again at render time), so
 * this file is not the enforcement mechanism. What it adds is SPEED: the build
 * takes seconds and needs a full toolchain, while a missing banner string is
 * exactly the kind of thing a translator PR gets wrong, and `npm test` is where
 * that PR gets its first signal.
 *
 * It also covers the one failure the build CANNOT see: a locale that carries
 * every key but left the English text in place. Parity passes; the Arabic
 * visitor reads "Close".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const I18N_DIR = resolve(__dirname, '../src/data/i18n');

const read = (file: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(resolve(I18N_DIR, file), 'utf8'));

const FILES = readdirSync(I18N_DIR).filter((f) => f.endsWith('.json')).sort();
const LOCALES = FILES.map((f) => f.replace('.json', ''));
const EN = read('en.json');

// The six the banner renders. Listed literally rather than derived from en.json
// so that DELETING a key from every locale at once still fails this test —
// a derived list would simply shrink and stay green.
const CONSENT_KEYS = ['accept', 'body', 'close', 'decline', 'more', 'settings'];

// Locales whose script cannot coincide with English by accident. A Latin-script
// locale may legitimately keep "Cookies" or "OK"; none of these can, so an exact
// match with the English string means the file was never translated.
const NON_LATIN = [
  'ar', 'bg', 'bn', 'el', 'fa', 'he', 'hi', 'ja', 'ko',
  'ru', 'sr', 'ta', 'te', 'th', 'uk', 'zh',
];

describe('consent.* strings', () => {
  it('ships one file per supported locale', () => {
    // 42 files: 41 translations plus en.json itself. A dropped file would
    // otherwise vanish silently — every per-locale check below iterates the
    // files that EXIST, so a deletion shrinks the suite instead of failing it.
    expect(FILES).toHaveLength(42);
    expect(LOCALES).toContain('en');
  });

  it('defines every banner key in en.json', () => {
    expect(Object.keys(EN.consent).sort()).toEqual([...CONSENT_KEYS].sort());
  });

  it.each(FILES)('%s carries all six keys, non-empty', (file) => {
    const strings = read(file);
    expect(strings.consent).toBeDefined();
    for (const key of CONSENT_KEYS) {
      const value = strings.consent[key];
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
    }
  });

  it.each(FILES)('%s has no EXTRA consent keys beyond en.json', (file) => {
    // The build rejects extras too — an orphaned key is dead weight that reads
    // as a feature someone forgot to wire up.
    expect(Object.keys(read(file).consent).sort()).toEqual([...CONSENT_KEYS].sort());
  });

  it.each(NON_LATIN)('%s is actually translated, not English left in place', (locale) => {
    const consent = read(`${locale}.json`).consent;
    // Only the three VERBS are checked.
    //
    // `body` is a sentence and may legitimately carry the Latin word "cookies"
    // inside it — Greek and Russian both do. `settings` is the same word used
    // as a label, and several locales borrow it wholesale rather than coining a
    // native term: el keeps "Cookies", ru shortens to "Cookie". That is the
    // locale's own convention, not an untranslated string, and asserting on it
    // would be this test telling a translator they are wrong.
    //
    // Accept / Decline / Close have no such excuse in a non-Latin script.
    for (const key of ['accept', 'decline', 'close']) {
      expect(consent[key]).not.toBe(EN.consent[key]);
    }
  });

  it.each(FILES)('%s keeps banner strings free of markup and placeholders', (file) => {
    // esc() escapes these into visible garbage rather than rendering them, so a
    // stray tag or an unfilled {placeholder} reaches the visitor as literal text.
    for (const key of CONSENT_KEYS) {
      const value = read(file).consent[key];
      expect(value).not.toMatch(/[<>]/);
      expect(value).not.toMatch(/[{}]/);
    }
  });

  it.each(FILES)('%s keeps consent.body short enough for the mobile banner', (file) => {
    // Below 520px the banner stacks and both buttons share a row; a runaway
    // translation pushes them off-screen, which is only ever caught by eye.
    expect(read(file).consent.body.length).toBeLessThan(220);
  });
});
