import { Subtitle, Track } from './types';

export class AppState {
    tracks: Track[] = [];
    activeTrackIndex: number = 0;
    secondaryTrackIndex: number = 0;
    displayMode: 'single' | 'dual' | 'guess' = 'dual';
    overlayEnabled: boolean = true;
    currentIndex: number = -1;
    isHovering: boolean = false;
    guessState: Map<number, number> = new Map();

    addTrack(name: string, subtitles: Subtitle[]): void {
        this.tracks.push({ name, subtitles });
        this.applyPreferences();
    }

    reset(): void {
        this.tracks = [];
        this.activeTrackIndex = 0;
        this.secondaryTrackIndex = 0;
        this.currentIndex = -1;
        this.guessState.clear();
    }

    applyPreferences(): void {
        if (this.tracks.length === 0) return;

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

    isDuplicate(newSubs: Subtitle[]): boolean {
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
            return true;
        }
        return false;
    }

    toggleDualMode(): boolean {
        if (this.hasMultipleTracks()) {
            this.displayMode = this.displayMode === 'single' ? 'dual' : 'single';
            return true;
        }
        return false;
    }

    toggleGuessMode(): boolean {
        if (this.displayMode === 'guess') {
            this.displayMode = 'dual';
        } else {
            this.displayMode = 'guess';
            this.resetGuessState();
        }
        return true;
    }

    revealNextWord(index: number): boolean {
        const mainTrack = this.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return false;

        const words = mainTrack[index].text.split(/\s+/);
        const current = this.guessState.get(index) ?? 1;

        if (current >= words.length) return true; // already fully revealed

        this.guessState.set(index, current + 1);
        return current + 1 >= words.length;
    }

    getRevealedCount(index: number): number {
        return this.guessState.get(index) ?? 1;
    }

    isFullyRevealed(index: number): boolean {
        const mainTrack = this.getMainTrack();
        if (!mainTrack || !mainTrack[index]) return false;
        const words = mainTrack[index].text.split(/\s+/);
        return this.getRevealedCount(index) >= words.length;
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
