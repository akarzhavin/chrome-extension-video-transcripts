/** @jest-environment node */
// The feature rules alone (english repo spec 032-feature-rollout-admin): no chrome, no DOM, no fetch.

import {
    FEATURE_AI,
    FEATURE_AI_TRANSLATE,
    FEATURE_SECOND_TRACK,
    gateNeeds,
    isGateOpen,
    isOn,
    isStale,
    MAX_AGE_MS,
    parseFeatures,
    parseRefusal,
    RETRY_MS,
    type Gate,
    type Kept,
} from '../src/features/rules';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const kept = (features: Record<string, boolean>, at = NOW): Kept => ({ features, at });

test('runs where there is no chrome', () => {
    expect((globalThis as { chrome?: unknown }).chrome).toBeUndefined();
});

describe('parseFeatures', () => {
    test('keeps only booleans by key, and nothing from a malformed answer', () => {
        expect(parseFeatures({ features: { a: true, b: false, c: 'yes' } })).toEqual({ a: true, b: false });
        expect(parseFeatures({ nope: 1 })).toBeNull();
        expect(parseFeatures({ features: 'x' })).toBeNull();
        expect(parseFeatures(null)).toBeNull();
    });
});

describe('isOn', () => {
    test('without an answer, or a key the answer lacks: AI and translation on, the second track off', () => {
        for (const k of [null, kept({})]) {
            expect(isOn(k, FEATURE_AI)).toBe(true);
            expect(isOn(k, FEATURE_AI_TRANSLATE)).toBe(true);
            expect(isOn(k, FEATURE_SECOND_TRACK)).toBe(false);
        }
        expect(isOn(kept({ [FEATURE_AI]: false, [FEATURE_SECOND_TRACK]: true }), FEATURE_AI)).toBe(false);
        expect(isOn(kept({ [FEATURE_SECOND_TRACK]: true }), FEATURE_SECOND_TRACK)).toBe(true);
    });
});

describe('gates', () => {
    const all = (k: Kept | null) => (['badge', 'translation', 'hint'] as Gate[]).map((g) => isGateOpen(k, g));
    test('AI closes every gate; each opens only with every key it needs', () => {
        expect(all(kept({ [FEATURE_AI]: false, [FEATURE_AI_TRANSLATE]: true, [FEATURE_SECOND_TRACK]: true }))).toEqual([false, false, false]);
        expect(all(kept({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: false, [FEATURE_SECOND_TRACK]: true }))).toEqual([true, false, false]);
        expect(all(kept({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true }))).toEqual([true, true, false]);
        expect(all(kept({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true, [FEATURE_SECOND_TRACK]: true }))).toEqual([true, true, true]);
    });

    test('before any answer: the badge and translation open, the hint closed', () => {
        expect(all(null)).toEqual([true, true, false]);
    });

    test('a refused key tells a refused hint from refused translation', () => {
        expect(gateNeeds('hint', FEATURE_SECOND_TRACK)).toBe(true);
        expect(gateNeeds('translation', FEATURE_SECOND_TRACK)).toBe(false);
        expect(gateNeeds('translation', FEATURE_AI_TRANSLATE)).toBe(true);
        expect(gateNeeds('badge', FEATURE_AI)).toBe(true);
        expect(gateNeeds('badge', 'lookup.phrase_cloud')).toBe(false);
    });
});

describe('isStale', () => {
    test('an answer stands for ten minutes, and not one from the future', () => {
        expect(isStale(kept({}), null, NOW + MAX_AGE_MS - 1)).toBe(false);
        expect(isStale(kept({}), null, NOW + MAX_AGE_MS)).toBe(true);
        expect(isStale(kept({}), null, NOW - 1)).toBe(true);
        expect(isStale(null, null, NOW)).toBe(true);
    });

    test('after a failed read, a minute passes before asking again; a stamp from the future does not hold it', () => {
        expect(isStale(null, NOW, NOW + RETRY_MS - 1)).toBe(false);
        expect(isStale(null, NOW, NOW + RETRY_MS)).toBe(true);
        expect(isStale(kept({}, NOW - MAX_AGE_MS), NOW, NOW + 1_000)).toBe(false);
        expect(isStale(null, NOW + 1, NOW)).toBe(true);
    });
});

describe('parseRefusal', () => {
    test('only a 404 feature_off is a refusal; its key comes back, "" when unnamed', () => {
        expect(parseRefusal(404, { code: 'track_unknown' })).toBeNull();
        expect(parseRefusal(403, { code: 'feature_off', feature: FEATURE_AI })).toBeNull();
        expect(parseRefusal(404, { code: 'feature_off' })).toBe('');
        expect(parseRefusal(404, { code: 'feature_off', feature: 7 })).toBe('');
        expect(parseRefusal(404, { code: 'feature_off', feature: 'lookup.phrase_cloud' })).toBe('lookup.phrase_cloud');
    });
});
