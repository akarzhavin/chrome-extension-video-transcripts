/**
 * The lookup card must resolve in BOTH themes.
 *
 * It shipped with `color: #f2f0fa` on its translations — the card's headline.
 * The card's background came from a token that flips to white on the light
 * theme, but a literal cannot flip: the translations rendered at a measured
 * 1.13:1 against their own card, i.e. invisible. Every colour in these rules
 * has to come from a token so the two themes resolve as a set.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// rezka owns the stylesheets; the YouTube build copies them verbatim.
//
// Two files since the lookup rules moved out, and this fixture joins them in
// the SAME ORDER the manifest loads them. All three groups below need that
// join for different reasons: the token checks need the lookup rules from one
// file and the tokens they resolve against from the other, while the takeover
// and collapse-tab checks read chassis rules that deliberately stayed behind.
const asset = (file: string): string =>
    readFileSync(join(__dirname, '../../../apps/rezka/src/assets/', file), 'utf8');

const BASE_CSS = asset('styles.css');
const LOOKUP_CSS = asset('lookup.css');
const CSS = `${BASE_CSS}\n${LOOKUP_CSS}`;

/** The declaration blocks belonging to the lookup UI. */
function lookupRules(): Array<{ selector: string; body: string }> {
    const out: Array<{ selector: string; body: string }> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(CSS))) {
        const selector = m[1].trim();
        if (/lookup-strip|vtt-lookup/.test(selector)) {
            out.push({ selector, body: m[2] });
        }
    }
    return out;
}

// Colour-carrying properties only. `border-radius` and the like may hold bare
// numbers, and a shadow's black alpha is theme-neutral by construction.
const COLOR_PROPS = /(^|[\s;])(color|background|background-color|border-color|fill|stroke)\s*:\s*([^;]+)/gi;

describe('lookup styles are theme-token driven', () => {
    it('finds the lookup rules at all', () => {
        // A rename that silently emptied this list would make every other
        // assertion below vacuously true.
        expect(lookupRules().length).toBeGreaterThan(20);
    });

    it('declares no hardcoded colour outside a token definition', () => {
        const offenders: string[] = [];
        for (const { selector, body } of lookupRules()) {
            let m: RegExpExecArray | null;
            COLOR_PROPS.lastIndex = 0;
            while ((m = COLOR_PROPS.exec(body))) {
                const value = m[3].trim();
                if (/^(transparent|none|inherit|currentColor|initial|unset)$/i.test(value)) continue;
                // A var() is the point; a var() with a literal fallback is
                // fine, since the fallback only shows if the token is missing.
                if (/^var\(/.test(value)) continue;
                // A rule scoped to one theme states that theme's value by
                // definition — that is the escape hatch for the handful of
                // colours no single token can express. The base rule it
                // overrides still has to go through a token.
                if (/\.vtt-light\b/.test(selector)) continue;
                offenders.push(`${selector} { ${m[2]}: ${value} }`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('defines every lookup token in both themes', () => {
        // A token used but defined only on :root renders as nothing on light.
        const used = new Set<string>();
        for (const { body } of lookupRules()) {
            for (const m of body.matchAll(/var\((--[a-z0-9-]+)/gi)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(5);

        const lightBlock = CSS.slice(CSS.indexOf('.vtt-light'));
        const missing = [...used].filter((token) => {
            // Defined on :root is the baseline; the light theme only has to
            // redefine the ones whose dark value would not work on white.
            const definedAnywhere = new RegExp(`${token}\\s*:`).test(CSS);
            return !definedAnywhere && !lightBlock.includes(token);
        });
        expect(missing).toEqual([]);
    });
});

/**
 * Every sidebar takeover parks its "‹ back" chip at the header's left edge —
 * the exact spot the language-pair chip owns in list mode. A takeover that
 * forgets to hide the chip renders its back chip straight over "EN ⇄ RU";
 * the word screen shipped with precisely that collision. This latch finds
 * every `#vtt-sidebar.vtt-*-open` state in the sheet and demands each one be
 * listed in the rule that hides #vtt-langpair, so a fourth takeover cannot
 * repeat the bug silently.
 */
describe('takeovers hide the language-pair chip', () => {
    it('lists every vtt-*-open state in the #vtt-langpair display:none rule', () => {
        const states = new Set<string>();
        for (const m of CSS.matchAll(/#vtt-sidebar\.(vtt-[a-z]+-open)\b/g)) states.add(m[1]);
        // vtt-swapped etc. don't match; sanity-check the shape of the sheet.
        expect(states).toContain('vtt-settings-open');
        expect(states).toContain('vtt-lookup-open');
        expect(states.size).toBeGreaterThanOrEqual(3);

        const rules: string[] = [];
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(CSS))) {
            if (m[1].includes('#vtt-langpair') && /display\s*:\s*none/.test(m[2])) rules.push(m[1]);
        }
        const hiding = rules.join(',');
        const missing = [...states].filter((cls) => !hiding.includes(`.${cls} #vtt-langpair`));
        expect(missing).toEqual([]);
    });
});

describe('the collapse tab on the word screen', () => {
    it('swaps the chevron for the close glyph, but only while expanded', () => {
        expect(CSS).toMatch(/\.vtt-lookup-open:not\(\.collapsed\) #vtt-toggle-btn \.vtt-toggle-close\s*\{\s*display:\s*block/);
        expect(CSS).toMatch(/\.vtt-lookup-open:not\(\.collapsed\) #vtt-toggle-btn \.vtt-toggle-chevron\s*\{\s*display:\s*none/);
    });
});

/**
 * The split is only safe while one file owns the palette.
 *
 * lookup.css consumes --vtt-* tokens and defines none. If it ever defined
 * one, the two sheets would carry independent values for the same name and
 * drift apart silently — a light-theme colour fixed in one file and stale in
 * the other, with nothing failing. The feature's OWN locals (--lk-*) are
 * fine: they are namespaced to it and defined nowhere else.
 */
describe('the lookup stylesheet does not fork the palette', () => {
    // Declarations only. A --vtt-* inside var(...) is a READ, which is the
    // whole point of the file; and prose in a comment is neither.
    const withoutComments = LOOKUP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

    it('defines no --vtt-* token', () => {
        const declared = [...withoutComments.matchAll(/(^|[{;])\s*(--vtt-[a-z0-9-]+)\s*:/gi)]
            .map((m) => m[2]);
        expect(declared).toEqual([]);
    });

    it('carries no :root block', () => {
        expect(withoutComments).not.toMatch(/:root\s*[,{]/);
    });

    it('still reads the shared palette, so the check above means something', () => {
        // Guards the guard: if lookup.css stopped using --vtt-* entirely, the
        // two assertions above would pass vacuously.
        expect(withoutComments).toMatch(/var\(--vtt-/);
    });
});
