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
});
