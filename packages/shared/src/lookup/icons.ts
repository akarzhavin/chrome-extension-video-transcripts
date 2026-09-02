// The feature's inline SVGs and its part-of-speech labels — shared by both
// surfaces, so the hover card and the word screen can never drift apart.
//
// The heart in particular used to be declared twice, byte-identical, once per
// surface, with a comment on the second copy noting it had to match the first.
// It is one constant now, and matching is no longer something to remember.
import { msg } from '../i18n';

// The localized short label for a part-of-speech tag the server sends. The
// fallback is the tag itself, so an unknown tag renders as-is instead of
// vanishing. These label the word's ROLES; they never label individual
// translations — wiktionary's translations are one flat list with no per-tag
// split, and pinning tags onto them would be a guess.
const POS_KEYS: Record<string, string> = {
    'n.': 'ytPosNoun',
    'v.': 'ytPosVerb',
    'adj.': 'ytPosAdj',
    'adv.': 'ytPosAdv',
    'prep.': 'ytPosPrep',
    'conj.': 'ytPosConj',
    'pron.': 'ytPosPron',
    'intj.': 'ytPosIntj',
    'num.': 'ytPosNum',
    'phr.': 'ytPosPhrase',
};

/**
 * A function, not a precomputed map: msg() must resolve at CALL time. The demo
 * installs a locale override after this module loads, and a map built at
 * module scope would freeze the labels before that override exists.
 */
export function posLabel(tag: string): string {
    const key = POS_KEYS[tag];
    return key ? msg(key, tag) : tag;
}

// Arrow-out: "this opens a bigger view" — the word screen in the sidebar.
export const MORE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M7 17L17 7M9 7h8v8"/></svg>';

// The save control, on the hover card and on the word screen alike.
export const HEART_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 22.5l7.1-7.1 1.7-1.7a5 5 0 0 0 0-7.1z"/></svg>';

// The same arrow as MORE_SVG, but for a link that leaves the extension (the
// Oxford button). Rounded caps and joins: it sits beside body text on the word
// screen rather than inside a button, where the sharp corners read as a glyph.
export const ICON_EXTERNAL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 17L17 7M9 7h8v8"/></svg>';
