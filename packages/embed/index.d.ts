// Public typings for @video-transcripts/embed. Checked in and self-contained:
// re-exporting from src/ would pull the bundled extension sources (and their
// build-time globals) into every consumer's program, so the public surface —
// two names and their option types — is restated here. Keep in sync with
// src/types.ts.

export interface SubtitleLine {
    /** Seconds from the start of the clip. */
    startTime: number;
    endTime: number;
    text: string;
}

export interface EmbedTrack {
    /** Display name, e.g. "English" — also what the language pair matches on. */
    name: string;
    /**
     * BCP-47 primary code, e.g. 'en'. Only the language-pair chip needs it (it
     * shows EN ⇄ RU); omit it and the chip falls back to the track name.
     */
    lang?: string;
    lines: SubtitleLine[];
}

export interface EmbedOptions {
    /** Where to mount. The element is emptied and takes over layout of the player + sidebar. */
    container: HTMLElement;
    /** Video file to play under the subtitles. Any URL a <video> can load. */
    videoSrc?: string;
    /**
     * Alternative source: a real YouTube player (IFrame API) for this video id.
     * The extension UI runs against the player's clock; supply `tracks`
     * prepared for this exact video. Exactly one of videoSrc / youtubeVideoId
     * is required.
     */
    youtubeVideoId?: string;
    /** Start offset in seconds for the YouTube source. */
    youtubeStart?: number;
    /** Loop window end for the YouTube source: rewinds to youtubeStart here. */
    youtubeEnd?: number;

    /**
     * Fires when the YouTube source errors or never starts (embedding
     * disallowed, bot interstitial). Callers typically destroy() and remount
     * with a file source.
     */
    onPlaybackFail?: () => void;
    /** Poster shown before playback starts. */
    poster?: string;
    /**
     * Subtitle tracks. The first is the language being learned, the second the
     * viewer's own; more are selectable from the sidebar's track pickers.
     */
    tracks: EmbedTrack[];
    /** Start playing on mount. Muted autoplay, so browsers allow it. */
    autoplay?: boolean;
    loop?: boolean;
    /** Reading mode to open with. */
    mode?: 'dual' | 'single' | 'guess';
    /** Draw the subtitle overlay on the video. */
    overlay?: boolean;
    /** Show the pull-out tab that collapses the sidebar. */
    collapsible?: boolean;
    /** Player chrome (progress bar, time, CC, fullscreen) under the video. */
    playerChrome?: boolean;
    /** Account state the embedded UI reports. Nothing is ever sent anywhere. */
    signedIn?: boolean;
    accountEmail?: string;
    savedWordCount?: number;
    /** Fires when a word is saved from the selection pill. */
    onWordSaved?: (term: string, context: string) => void;
    /** Fires when the sign-in affordance is used. */
    onSignInClick?: () => void;
    /**
     * Fires whenever the reading mode changes, from ANY entry point — the
     * sidebar's own quick-mode buttons and settings included, not just
     * setMode().
     */
    onModeChange?: (mode: 'dual' | 'single' | 'guess') => void;
    /**
     * Fires when another copy of the Lingogram UI already owns the #vtt-* ids
     * on this page (in practice, the installed extension). The embed renders no
     * UI in that case, so the host should explain the collision.
     */
    onOwnershipConflict?: () => void;
}

export interface EmbedInstance {
    /** Tear down: removes the UI, listeners and the chrome shim. */
    destroy(): void;
    /** Switch reading mode at runtime. */
    setMode(mode: 'dual' | 'single' | 'guess'): void;
    /** Collapse or expand the sidebar. */
    setCollapsed(collapsed: boolean): void;
    /** Show or hide the on-video subtitle overlay. */
    setOverlay(on: boolean): void;
    /** The <video> element for the file source; null for the YouTube source. */
    readonly video: HTMLVideoElement | null;
}

export declare function mount(options: EmbedOptions): EmbedInstance;
