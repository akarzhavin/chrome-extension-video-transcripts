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

    // Regression: two rezka tracks for one film (theatrical vs director's cut)
    // are both Russian and share their opening and middle cue, which is all the
    // content check samples. Collapsing them dropped the second track, so
    // picking "(реж.)" showed the theatrical one — the only track left.
    test('isDuplicate should not collapse same-content tracks under different names', () => {
        const subs: Subtitle[] = [
            { text: 'Hello', startTime: 0, endTime: 1 },
            { text: 'World', startTime: 1, endTime: 2 },
            { text: 'Test', startTime: 2, endTime: 3 }
        ];
        state.addTrack('Russian — Оригинал (+субтитры)', subs);

        expect(state.isDuplicate(subs, 'Russian — Оригинал (+субтитры) (реж.)')).toBe(false);
        expect(state.isDuplicate(subs, 'Russian — Оригинал (+субтитры)')).toBe(true);
    });

    test('isDuplicate keeps content-only behaviour when no name is given', () => {
        const subs: Subtitle[] = [
            { text: 'Hello', startTime: 0, endTime: 1 },
            { text: 'World', startTime: 1, endTime: 2 },
            { text: 'Test', startTime: 2, endTime: 3 }
        ];
        state.addTrack('English', subs);

        expect(state.isDuplicate(subs)).toBe(true);
    });

    // The language word has to survive in the name: pair ordering matches on it.
    test('applyPreferences still orders labelled rezka tracks by language pair', () => {
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('Russian — Оригинал (+субтитры) (реж.)', [{ text: 'Привет' } as Subtitle]);
        state.addTrack('English — Original', [{ text: 'Hello' } as Subtitle]);

        expect(state.tracks[state.activeTrackIndex].name).toBe('English — Original');
        expect(state.tracks[state.secondaryTrackIndex].name).toBe('Russian — Оригинал (+субтитры) (реж.)');
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

    describe('getPairedSecondary', () => {
        const mainSub: Subtitle = { text: 'main', startTime: 10, endTime: 15 };

        test('returns empty array when no secondary track exists', () => {
            state.addTrack('English', [mainSub]);
            expect(state.getPairedSecondary(mainSub)).toEqual([]);
        });

        test('a translation cue that drifts across two lines is shown once, under the line it mostly covers', () => {
            // The Netflix case (70094483): the Russian track is cut by its own
            // translator and runs a few hundred ms behind the English one. Under
            // an any-overlap rule each Russian cue was attached to BOTH English
            // lines it touched, so the sidebar showed "и заменить их…" under the
            // line before its own and again under its own, joined with " | ".
            const en = [
                { text: 'and replace them with bottled water', startTime: 0, endTime: 2 },
                { text: 'and naturally sweetened fruit juice.', startTime: 2, endTime: 4 },
                { text: 'Are you talking about diet soda too?', startTime: 4, endTime: 6 },
            ];
            const ru = [
                { text: 'и заменить их минеральной водой', startTime: 0.3, endTime: 2.4 },
                { text: 'и натуральными фруктовыми соками.', startTime: 2.4, endTime: 4.3 },
                { text: 'И диетические тоже?', startTime: 4.3, endTime: 6.1 },
            ];
            state.addTrack('English', en);
            state.addTrack('Russian', ru);

            expect(en.map((cue) => state.getPairedSecondary(cue).map((s) => s.text))).toEqual([
                ['и заменить их минеральной водой'],
                ['и натуральными фруктовыми соками.'],
                ['И диетические тоже?'],
            ]);
        });

        test('cues inside the main cue are kept in time order; touching edges are not overlap', () => {
            const secondary: Subtitle[] = [
                { text: 'before', startTime: 0, endTime: 9 },
                { text: 'touching-start', startTime: 5, endTime: 10 },
                { text: 'inside-late', startTime: 13, endTime: 14 },
                { text: 'inside-early', startTime: 11, endTime: 12 },
                { text: 'touching-end', startTime: 15, endTime: 20 },
                { text: 'after', startTime: 16, endTime: 20 },
            ];
            state.addTrack('English', [mainSub]);
            state.addTrack('Russian', secondary);

            expect(state.getPairedSecondary(mainSub).map((s) => s.text)).toEqual(['inside-early', 'inside-late']);
        });

        test('returns empty array when no secondary sub overlaps', () => {
            state.addTrack('English', [mainSub]);
            state.addTrack('Russian', [{ text: 'far', startTime: 100, endTime: 200 } as Subtitle]);
            expect(state.getPairedSecondary(mainSub)).toEqual([]);
        });

        test('follows a swap: the pairing is recomputed for the new main track', () => {
            const en = [{ text: 'EN', startTime: 0, endTime: 2 }];
            const ru = [{ text: 'RU', startTime: 0.2, endTime: 2.2 }];
            state.addTrack('English', en);
            state.addTrack('Russian', ru);
            expect(state.getPairedSecondary(en[0]).map((s) => s.text)).toEqual(['RU']);

            state.swapTracks();
            expect(state.getPairedSecondary(ru[0]).map((s) => s.text)).toEqual(['EN']);
            // The old main cue is no longer a key of anything.
            expect(state.getPairedSecondary(en[0])).toEqual([]);
        });
    });

    describe('guess-mode reveal', () => {
        // Reveal counts tokens the same way SidebarUI renders them (shared
        // tokenizeForGuess). When it did not — a naive split(/\s+/) here versus
        // Intl.Segmenter there — a spaceless line counted as one token, so it
        // read as fully revealed from the start and never advanced.
        const track = (text: string) =>
            state.addTrack('Main', [{ text, startTime: 0, endTime: 1 } as Subtitle]);

        test('advances word by word through a space-delimited line', () => {
            track('one two three');
            expect(state.getRevealedCount(0)).toBe(1); // first word is free
            expect(state.isFullyRevealed(0)).toBe(false);

            expect(state.revealNextWord(0)).toBe(false);
            expect(state.getRevealedCount(0)).toBe(2);

            expect(state.revealNextWord(0)).toBe(true); // last word
            expect(state.getRevealedCount(0)).toBe(3);
            expect(state.isFullyRevealed(0)).toBe(true);
        });

        test('advances through a spaceless line (CJK regression)', () => {
            track('你好世界朋友');
            // Previously length-1 under split(/\s+/) → instantly "complete".
            expect(state.isFullyRevealed(0)).toBe(false);

            const before = state.getRevealedCount(0);
            state.revealNextWord(0);
            expect(state.getRevealedCount(0)).toBeGreaterThan(before);
        });

        test('reveals a spaceless line to completion', () => {
            track('你好世界朋友');
            // Bounded loop: whatever the tokenizer produced, repeated reveals
            // must terminate rather than stall short of the end.
            for (let i = 0; i < 50 && !state.isFullyRevealed(0); i++) state.revealNextWord(0);
            expect(state.isFullyRevealed(0)).toBe(true);
        });

        test('a bracketed sound cue is one unit, not three', () => {
            // "[beep]" has no spaces, but it is not a spaceless script — the
            // Segmenter used to carve it into "[", "beep", "]": three gaps for
            // a cue nobody can guess.
            track('[beep]');
            expect(state.isFullyRevealed(0)).toBe(true); // single free word
        });

        test('punctuation-only tokens do not demand reveals', () => {
            track('- hello world -');
            // Two maskable words; the first is free, so one reveal finishes.
            expect(state.isFullyRevealed(0)).toBe(false);
            expect(state.revealNextWord(0)).toBe(true);
            expect(state.isFullyRevealed(0)).toBe(true);
        });

        test('setDisplayMode picks directly: three modes, no hidden state', () => {
            state.addTrack('A', [{ text: 'one two', startTime: 0, endTime: 1 } as Subtitle]);
            state.addTrack('B', [{ text: 'x', startTime: 0, endTime: 1 } as Subtitle]);

            expect(state.setDisplayMode('guess')).toBe(true);
            expect(state.setDisplayMode('guess')).toBe(false); // same mode = no-op
            expect(state.setDisplayMode('single')).toBe(true);
            expect(state.displayMode).toBe('single');
            expect(state.setDisplayMode('dual')).toBe(true);
        });

        test('dual needs a second track; guess starts a fresh round', () => {
            state.addTrack('A', [{ text: 'one two three', startTime: 0, endTime: 1 } as Subtitle]);
            expect(state.setDisplayMode('dual')).toBe(false); // one track

            state.setDisplayMode('guess');
            state.revealNextWord(0);
            expect(state.getRevealedCount(0)).toBe(2);
            state.setDisplayMode('single');
            state.setDisplayMode('guess'); // re-entry resets progress
            expect(state.getRevealedCount(0)).toBe(1);
        });

        test('treats a missing line as not revealed', () => {
            track('one two');
            expect(state.isFullyRevealed(99)).toBe(false);
            expect(state.revealNextWord(99)).toBe(false);
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
