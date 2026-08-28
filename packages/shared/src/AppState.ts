import { LanguageChoice, Subtitle, Track } from './types';
import { tokenizeForGuess, isMaskableToken } from './guess-tokenize';

export class AppState {
    tracks: Track[] = [];
    activeTrackIndex: number = 0;
    secondaryTrackIndex: number = 0;
    // True while the display order is manually inverted relative to the
    // learning→native preference (any swap entry point toggles it). Drives the
    // language chip's visual order; reset whenever applyPreferences re-derives
    // the indexes from the preference.
    swapped: boolean = false;

    // When set (Netflix), the settings-panel dropdowns become language pickers
    // driven by this catalog — available languages first, then the rest of the
    // supported catalog shown disabled — instead of track pickers over `tracks`.
    // `selectedLearningCode` / `selectedNativeCode` track the chosen language for
    // each slot so the dropdown reflects the pick immediately, even while the
    // track is still being fetched. Left undefined for YouTube/Rezka.
    languageCatalog?: LanguageChoice[];
    selectedLearningCode?: string;
    selectedNativeCode?: string;
    displayMode: 'single' | 'dual' | 'guess' = 'dual';
    overlayEnabled: boolean = true;
    currentIndex: number = -1;
    isHovering: boolean = false;
    guessState: Map<number, number> = new Map();

    // When set (YouTube, driven by the user's chosen language pair), track
    // selection matches these display-name fragments instead of the legacy
    // English/Russian heuristic. Left undefined for Rezka → legacy behavior.
    primaryLangLabel?: string;
    secondaryLangLabel?: string;

    setLanguagePreferences(primary?: string, secondary?: string): void {
        this.primaryLangLabel = primary;
        this.secondaryLangLabel = secondary;
        this.applyPreferences();
    }

    /**
     * Whether a track matching the given preference label actually loaded.
     *
     * Finding one language but not the other is a normal outcome, not a
     * failure: plenty of videos caption the spoken language only. Callers use
     * this to say which half is missing instead of reporting a blanket "no
     * subtitles" while a track is visibly playing. Mirrors the matching in
     * applyPreferences() rather than restating it.
     */
    private hasTrackFor(label?: string): boolean {
        if (!label) return false;
        return this.tracks.some(t => t.name.includes(label));
    }

    /** A track for the language being learned loaded. */
    hasLearningTrack(): boolean {
        return this.hasTrackFor(this.primaryLangLabel);
    }

    /** A track for the user's native language loaded (the translation half). */
    hasNativeTrack(): boolean {
        return this.hasTrackFor(this.secondaryLangLabel);
    }

    addTrack(name: string, subtitles: Subtitle[]): void {
        this.tracks.push({ name, subtitles });
        this.applyPreferences();
    }

    reset(): void {
        this.tracks = [];
        this.activeTrackIndex = 0;
        this.secondaryTrackIndex = 0;
        this.swapped = false;
        this.currentIndex = -1;
        this.guessState.clear();
        // The language catalog is per-title — the next title's manifest rebuilds
        // it. The user's selected learning/native codes persist (they're the
        // language pair, not video state) so the picker keeps its selection.
        this.languageCatalog = undefined;
    }

    applyPreferences(): void {
        // Re-deriving indexes from the preference undoes any manual swap, so
        // the flag must follow.
        this.swapped = false;
        if (this.tracks.length === 0) return;

        // Preferred path: the user picked a language pair (YouTube). Match the
        // primary (language being learned) and secondary (native) tracks by the
        // display-name fragments the caller assigned.
        if (this.primaryLangLabel || this.secondaryLangLabel) {
            const primIndex = this.primaryLangLabel
                ? this.tracks.findIndex(t => t.name.includes(this.primaryLangLabel!))
                : -1;
            const secIndex = this.secondaryLangLabel
                ? this.tracks.findIndex(t => t.name.includes(this.secondaryLangLabel!))
                : -1;

            if (primIndex !== -1) {
                this.activeTrackIndex = primIndex;
                if (secIndex !== -1 && secIndex !== primIndex) {
                    this.secondaryTrackIndex = secIndex;
                } else if (this.tracks.length > 1) {
                    this.secondaryTrackIndex = (primIndex === 0) ? 1 : 0;
                }
            } else if (secIndex !== -1) {
                this.activeTrackIndex = secIndex;
                if (this.tracks.length > 1) {
                    this.secondaryTrackIndex = (secIndex === 0) ? 1 : 0;
                }
            } else {
                this.activeTrackIndex = 0;
                if (this.tracks.length > 1) this.secondaryTrackIndex = 1;
            }
            return;
        }

        // Legacy heuristic (Rezka): assume an English/Russian-Ukrainian pair.
        // Find indices of key languages
        const engIndex = this.tracks.findIndex(t => t.name.includes('English'));
        const rusIndex = this.tracks.findIndex(t => t.name.includes('Russian') || t.name.includes('Ukrainian'));

        // Scenario 1: English is present
        if (engIndex !== -1) {
            this.activeTrackIndex = engIndex; // English is always primary
            
            if (rusIndex !== -1) {
                this.secondaryTrackIndex = rusIndex; // Russian is always secondary
            } else if (this.tracks.length > 1) {
                // If Russian is not found, pick any other track as filler
                this.secondaryTrackIndex = (engIndex === 0) ? 1 : 0;
            }
        } 
        // Scenario 2: English is absent, but Russian is present
        else if (rusIndex !== -1) {
            this.activeTrackIndex = rusIndex; // Russian becomes primary
            if (this.tracks.length > 1) {
                this.secondaryTrackIndex = (rusIndex === 0) ? 1 : 0;
            }
        }
        // Scenario 3: Neither English nor Russian found
        else {
            this.activeTrackIndex = 0;
            if (this.tracks.length > 1) {
                this.secondaryTrackIndex = 1;
            }
        }
    }

    /**
     * Content check for "we already have this track".
     *
     * Compares only the first and middle cue, which is enough for the case it
     * was written for (the same file arriving twice) but NOT enough to tell two
     * genuinely different tracks apart when they share those cues — a film's
     * theatrical and director's-cut subtitles typically do.
     *
     * Pass `name` when the site gave the track its own identity: a name we have
     * not seen means a distinct track, whatever the sampled cues say. Callers
     * without a meaningful name (YouTube derives names from content) can omit
     * it and get the original content-only behaviour.
     */
    isDuplicate(newSubs: Subtitle[], name?: string): boolean {
        if (name !== undefined && !this.tracks.some(t => t.name === name)) return false;
        return this.tracks.some(track => 
            track.subtitles.length > 0 && 
            track.subtitles[0].text === newSubs[0].text && 
            track.subtitles[Math.floor(track.subtitles.length/2)]?.text === newSubs[Math.floor(newSubs.length/2)]?.text
        );
    }

    hasMultipleTracks(): boolean {
        return this.tracks.length > 1;
    }

    swapTracks(): boolean {
        if (this.hasMultipleTracks()) {
            [this.activeTrackIndex, this.secondaryTrackIndex] = [this.secondaryTrackIndex, this.activeTrackIndex];
            this.swapped = !this.swapped;
            return true;
        }
        return false;
    }

    /**
     * The mode picker's real shape: three mutually exclusive modes, chosen
     * directly. The UI used to expose two toggles and hide `single` as the
     * "neither selected" state — the YouTube player menu even carried a
     * workaround reconstructing a direct pick out of the toggles.
     * Returns whether anything changed (dual needs a second track; picking the
     * active mode is a no-op).
     */
    setDisplayMode(mode: 'single' | 'dual' | 'guess'): boolean {
        if (mode === this.displayMode) return false;
        if (mode === 'dual' && !this.hasMultipleTracks()) return false;
        this.displayMode = mode;
        if (mode === 'guess') this.resetGuessState();
        return true;
    }

    // Toggle wrappers for the Shift+D / Shift+G shortcuts, which flip between
    // a mode and its natural exit. The exits differ on purpose: leaving guess
    // lands on dual (the translation came back), while leaving dual lands on
    // single (the translation went away).
    toggleDualMode(): boolean {
        if (!this.hasMultipleTracks()) return false;
        return this.setDisplayMode(this.displayMode === 'dual' ? 'single' : 'dual');
    }

    toggleGuessMode(): boolean {
        if (this.displayMode !== 'guess') return this.setDisplayMode('guess');
        // With one track "dual" is rejected, which would strand the shortcut
        // in guess mode — fall back to single there.
        return this.setDisplayMode(this.hasMultipleTracks() ? 'dual' : 'single');
    }

    // How many maskable units the line holds. Must match how SidebarUI renders
    // them, hence the shared tokenizer — see guess-tokenize.ts. Punctuation-only
    // tokens are excluded on both sides: they are never masked, so counting
    // them would demand extra reveals for words that were visible all along.
    // Returns 0 when the line is missing, which keeps callers from reporting a
    // phantom line as fully revealed.
    private tokenCount(index: number): number {
        const mainTrack = this.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return 0;
        return tokenizeForGuess(mainTrack[index].text).tokens.filter(isMaskableToken).length;
    }

    revealNextWord(index: number): boolean {
        const mainTrack = this.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return false;

        const total = this.tokenCount(index);
        const current = this.guessState.get(index) ?? 1;

        if (current >= total) return true; // already fully revealed

        this.guessState.set(index, current + 1);
        return current + 1 >= total;
    }

    getRevealedCount(index: number): number {
        return this.guessState.get(index) ?? 1;
    }

    isFullyRevealed(index: number): boolean {
        const mainTrack = this.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return false;
        return this.getRevealedCount(index) >= this.tokenCount(index);
    }

    resetGuessState(): void {
        this.guessState.clear();
    }

    getMainTrack(): Subtitle[] | null {
        return this.tracks[this.activeTrackIndex]?.subtitles || null;
    }

    getSecondaryTrack(): Subtitle[] | null {
        return this.hasMultipleTracks() ? this.tracks[this.secondaryTrackIndex]?.subtitles : null;
    }

    getOverlappingSecondary(sub: Subtitle): Subtitle[] {
        const secondary = this.getSecondaryTrack();
        if (!secondary) return [];
        return secondary.filter(s => s.startTime < sub.endTime && s.endTime > sub.startTime);
    }
}
