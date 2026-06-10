/**
 * @jest-environment jsdom
 */

import { AppState } from '../src/AppState';
import { Subtitle } from '../src/types';

describe('AppState', () => {
    let state: AppState;

    beforeEach(() => {
        state = new AppState();
    });

    test('should initialize with default values', () => {
        expect(state.displayMode).toBe('dual');
        expect(state.overlayEnabled).toBe(true);
        expect(state.activeTrackIndex).toBe(0);
        expect(state.secondaryTrackIndex).toBe(0);
    });

    test('applyPreferences should prioritize English as main', () => {
        state.addTrack('Russian', [{ text: 'ru' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // Only Rus

        state.addTrack('English', [{ text: 'en' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(1); // Eng becomes Main
        expect(state.secondaryTrackIndex).toBe(0); // Rus becomes Sub
    });

    test('applyPreferences should prioritize Russian as main if no English', () => {
        state.addTrack('French', [{ text: 'fr' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // Only French

        state.addTrack('Russian', [{ text: 'ru' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(1); // Rus becomes Main
        expect(state.secondaryTrackIndex).toBe(0); // French becomes Sub
    });

    test('applyPreferences should keep English as main when other languages are added', () => {
        state.addTrack('English', [{ text: 'en' } as Subtitle]);
        state.addTrack('French', [{ text: 'fr' } as Subtitle]);
        state.addTrack('Spanish', [{ text: 'es' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(0); // English is still Main
        expect(state.secondaryTrackIndex).toBe(1); // First alternative is Sub
    });

    test('toggleDualMode should switch modes if multiple tracks exist', () => {
        state.addTrack('English', []);
        expect(state.toggleDualMode()).toBe(false); // Only 1 track

        state.addTrack('Russian', []);
        expect(state.toggleDualMode()).toBe(true);
        expect(state.displayMode).toBe('single'); // Switched from dual to single
    });

    test('toggleDualMode from guess lands on dual, not single (regression)', () => {
        // Prior bug: `dual = current === 'single' ? 'dual' : 'single'` meant
        // hitting Dual from guess sent you to single, hiding the secondary
        // translation. The fix flips the operand so Dual always means "go to
        // dual unless already there".
        state.addTrack('English', []);
        state.addTrack('Russian', []);
        state.displayMode = 'guess';
        expect(state.toggleDualMode()).toBe(true);
        expect(state.displayMode).toBe('dual');
    });

    test('swapTracks should swap active and secondary tracks', () => {
        state.addTrack('English', []);
        state.addTrack('Russian', []);
        
        const mainBefore = state.activeTrackIndex;
        const subBefore = state.secondaryTrackIndex;

        expect(state.swapTracks()).toBe(true);
        expect(state.activeTrackIndex).toBe(subBefore);
        expect(state.secondaryTrackIndex).toBe(mainBefore);
    });

    test('swapTracks should return false with single track', () => {
        state.addTrack('English', []);
        expect(state.swapTracks()).toBe(false);
    });

    test('isDuplicate should detect duplicate subtitles', () => {
        const subs: Subtitle[] = [
            { text: 'Hello', startTime: 0, endTime: 1 },
            { text: 'World', startTime: 1, endTime: 2 },
            { text: 'Test', startTime: 2, endTime: 3 }
        ];
        state.addTrack('English', subs);

        expect(state.isDuplicate(subs)).toBe(true);
        expect(state.isDuplicate([{ text: 'Different', startTime: 0, endTime: 1 }, { text: 'Content', startTime: 1, endTime: 2 }, { text: 'Here', startTime: 2, endTime: 3 }])).toBe(false);
    });

    test('getMainTrack should return the active track data', () => {
        const engSubs = [{ text: 'Hello' } as Subtitle];
        const rusSubs = [{ text: 'Привет' } as Subtitle];
        state.addTrack('English', engSubs);
        state.addTrack('Russian', rusSubs);

        expect(state.getMainTrack()).toBe(engSubs);
    });

    test('getSecondaryTrack should return secondary track data', () => {
        const engSubs = [{ text: 'Hello' } as Subtitle];
        const rusSubs = [{ text: 'Привет' } as Subtitle];
        state.addTrack('English', engSubs);
        state.addTrack('Russian', rusSubs);

        expect(state.getSecondaryTrack()).toBe(rusSubs);
    });

    test('getSecondaryTrack should return null with single track', () => {
        state.addTrack('English', [{ text: 'Hello' } as Subtitle]);
        expect(state.getSecondaryTrack()).toBeNull();
    });

    test('applyPreferences with 3 languages: English + Russian + Ukrainian', () => {
        state.addTrack('Ukrainian', [{ text: 'Привіт' } as Subtitle]);
        state.addTrack('English', [{ text: 'Hello' } as Subtitle]);
        state.addTrack('Russian', [{ text: 'Привет' } as Subtitle]);

        // English should be Main, first Rus/Ukr match should be Sub
        expect(state.activeTrackIndex).toBe(1); // English
        expect(state.secondaryTrackIndex).toBe(0); // Ukrainian (first Rus/Ukr match in the array)
    });

    test('applyPreferences with English loaded first, then Russian', () => {
        state.addTrack('English', [{ text: 'Hello' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // English is Main (only track)

        state.addTrack('Russian', [{ text: 'Привет' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // English stays Main
        expect(state.secondaryTrackIndex).toBe(1); // Russian becomes Sub
    });

    test('applyPreferences with Russian loaded first, then English', () => {
        state.addTrack('Russian', [{ text: 'Привет' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // Russian is Main (only track)

        state.addTrack('English', [{ text: 'Hello' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(1); // English takes over as Main
        expect(state.secondaryTrackIndex).toBe(0); // Russian becomes Sub
    });

    test('applyPreferences with unknown languages only', () => {
        state.addTrack('Japanese', [{ text: 'こんにちは' } as Subtitle]);
        state.addTrack('Korean', [{ text: '안녕하세요' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(0); // First track
        expect(state.secondaryTrackIndex).toBe(1); // Second track
    });

    describe('getOverlappingSecondary', () => {
        const mainSub: Subtitle = { text: 'main', startTime: 10, endTime: 15 };

        test('returns empty array when no secondary track exists', () => {
            state.addTrack('English', [mainSub]);
            expect(state.getOverlappingSecondary(mainSub)).toEqual([]);
        });

        test('returns subtitles whose time ranges overlap the main sub', () => {
            const secondary: Subtitle[] = [
                { text: 'before', startTime: 0, endTime: 9 },        // ends before main starts
                { text: 'touching-start', startTime: 5, endTime: 10 }, // ends exactly at main start — not overlap
                { text: 'partial-left', startTime: 8, endTime: 12 },  // overlaps
                { text: 'inside', startTime: 11, endTime: 14 },       // fully inside
                { text: 'partial-right', startTime: 14, endTime: 18 },// overlaps
                { text: 'touching-end', startTime: 15, endTime: 20 }, // starts exactly at main end — not overlap
                { text: 'after', startTime: 16, endTime: 20 },        // starts after main ends
            ];
            state.addTrack('English', [mainSub]);
            state.addTrack('Russian', secondary);

            const result = state.getOverlappingSecondary(mainSub).map(s => s.text);
            expect(result).toEqual(['partial-left', 'inside', 'partial-right']);
        });

        test('returns empty array when no secondary sub overlaps', () => {
            state.addTrack('English', [mainSub]);
            state.addTrack('Russian', [{ text: 'far', startTime: 100, endTime: 200 } as Subtitle]);
            expect(state.getOverlappingSecondary(mainSub)).toEqual([]);
        });
    });
});

describe('AppState language-pair preferences', () => {
    let state: AppState;
    beforeEach(() => {
        state = new AppState();
    });

    test('selects primary/secondary by the configured language labels', () => {
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('Spanish', [{ text: 'es' } as Subtitle]);
        state.addTrack('English', [{ text: 'en' } as Subtitle]);
        state.addTrack('Russian', [{ text: 'ru' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(1); // English
        expect(state.secondaryTrackIndex).toBe(2); // Russian
    });

    test('overrides the legacy English-first heuristic', () => {
        // Learner of Spanish: English must NOT become main just because it exists.
        state.setLanguagePreferences('Spanish', 'German');
        state.addTrack('English', [{ text: 'en' } as Subtitle]);
        state.addTrack('Spanish', [{ text: 'es' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(1); // Spanish, not English
    });

    test('falls back to the native track when the learning track is absent', () => {
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('German', [{ text: 'de' } as Subtitle]);
        state.addTrack('Russian', [{ text: 'ru' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(1); // Russian (native) becomes main
        expect(state.secondaryTrackIndex).toBe(0); // German filler
    });

    test('falls back to first/second track when neither label matches', () => {
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('German', [{ text: 'de' } as Subtitle]);
        state.addTrack('French', [{ text: 'fr' } as Subtitle]);

        expect(state.activeTrackIndex).toBe(0);
        expect(state.secondaryTrackIndex).toBe(1);
    });

    test('is order-independent (primary arrives after secondary)', () => {
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('Russian', [{ text: 'ru' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(0); // only track so far

        state.addTrack('English', [{ text: 'en' } as Subtitle]);
        expect(state.activeTrackIndex).toBe(1); // English takes over as main
        expect(state.secondaryTrackIndex).toBe(0); // Russian becomes secondary
    });
});
