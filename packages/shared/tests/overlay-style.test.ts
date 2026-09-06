/**
 * The option sets behind the settings screen's style rows.
 *
 * Behaviour map §10.16 (seven typefaces), §10.18 / §10.20 (five text swatches
 * per colour row), §10.22 (five box colours).
 *
 * The live checks in `e2e/settings-detail.spec.ts` count what the panel
 * renders. They cannot be made red without breaking the browser build, so the
 * counts are pinned here as well: a row that quietly loses an option fails
 * here in milliseconds, and the live check confirms the panel actually draws
 * what this file pins.
 *
 * Every count is written as a literal, never derived from the constant it
 * checks — `Object.keys(X).length === Object.keys(X).length` is green against
 * any list at all.
 */
import {
    OVERLAY_FONT_STACK,
    OVERLAY_FONT_VARIANT,
    OVERLAY_COLORS,
    OVERLAY_BG_COLORS,
} from '../src/overlay-style';

describe('the typefaces on offer', () => {
    /**
     * §10.16. Seven, because that is the CEA-708 set broadcast captions use;
     * the settings screen offers exactly those and nothing else. An eighth
     * added to the stack without a matching option in the dropdown — or a
     * seventh dropped from the stack — is the drift this catches.
     */
    test('the stack names the seven CEA-708 classes', () => {
        expect(Object.keys(OVERLAY_FONT_STACK).sort()).toEqual(
            ['casual', 'cursive', 'monoSans', 'monoSerif', 'propSans', 'propSerif', 'smallCaps'].sort(),
        );
        expect(Object.keys(OVERLAY_FONT_STACK)).toHaveLength(7);
    });

    /**
     * The variant table is consulted alongside the stack for every class, so a
     * class present in one and missing from the other renders with an
     * undefined font-variant rather than failing visibly.
     */
    test('every class also has a variant, and only small capitals is not normal', () => {
        expect(Object.keys(OVERLAY_FONT_VARIANT).sort()).toEqual(Object.keys(OVERLAY_FONT_STACK).sort());
        expect(OVERLAY_FONT_VARIANT.smallCaps).toBe('small-caps');
        const others = Object.entries(OVERLAY_FONT_VARIANT).filter(([k]) => k !== 'smallCaps');
        expect(others).toHaveLength(6);
        for (const [, v] of others) expect(v).toBe('normal');
    });
});

describe('the colour swatches', () => {
    /**
     * §10.18 and §10.20 — one palette, offered in both text rows. Five, plus
     * the custom well the panel adds beside them; the well is markup, not a
     * palette entry, which is why this is five and the rendered row is six
     * controls.
     */
    test('the text palette is the five documented colours, in order', () => {
        expect(OVERLAY_COLORS).toEqual(['#ffffff', '#ffd700', '#00e5ff', '#7CFC00', '#ff9800']);
        expect(OVERLAY_COLORS).toHaveLength(5);
    });

    /**
     * §10.22. The box palette is deliberately neutral rather than the accent
     * hues offered for the text: it sits behind glyphs.
     */
    test('the box palette is the five documented neutrals, in order', () => {
        expect(OVERLAY_BG_COLORS).toEqual(['#000000', '#3a3a3a', '#7a7a7a', '#ffffff', '#0a1a3c']);
        expect(OVERLAY_BG_COLORS).toHaveLength(5);
    });

    /**
     * The two palettes are separate lists on purpose. Pointing one at the
     * other would keep both counts at five and pass every check above, while
     * offering cyan and green as caption backgrounds.
     */
    test('the two palettes are not the same list', () => {
        expect(OVERLAY_BG_COLORS).not.toEqual(OVERLAY_COLORS);
    });
});
