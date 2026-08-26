import { labelForLanguage, parseVTT, TrackRole } from '@video-transcripts/shared';
import { BaseVttApp, SIDEBAR_CHROME_CSS } from '../app-base';
import { classifyStatus } from '../timedtext-fetch';
import {
    NetflixRawTrack,
    NetflixTrack,
    normalizeTracks,
    planNetflixTracks,
    decodeEntities,
    buildLanguageCatalog,
    trackForBaseCode,
    baseLang,
    isManifestForCurrentTitle,
} from './subtitles';

/**
 * Netflix adapter. Subtitles are discovered from the playback manifest captured
 * by the MAIN-world hook (see manifest-hook.ts), which posts NFLX_MANIFEST with
 * the raw `timedtexttracks`. We normalize those, pick the learning/native tracks,
 * fetch their WebVTT through the hook (page origin → passes the CDN's CORS), and
 * render via the shared sidebar. Unlike YouTube there's no machine translation,
 * so only languages the title actually ships are shown.
 */
class NetflixVttApp extends BaseVttApp {
    currentMovieId: string | null = null;
    loadedForMovie: string | null = null;
    // Normalized WebVTT tracks for the current title, kept so the settings-panel
    // language picker can fetch any offered language on demand (requestLanguageTrack).
    currentTracks: NetflixTrack[] = [];

    constructor() {
        super();
        console.log('[NFLX-VTT] content script running');
        this.init();
        this.startVideoPolling();
        this.startSite();
        void this.initLanguagePrefs();
    }

    // ── site hooks ──────────────────────────────────────────────────────────
    getVideoId(): string | null {
        // Netflix watch URL: /watch/<numericId>
        const m = location.pathname.match(/\/watch\/(\d+)/);
        return m ? m[1] : null;
    }

    getOverlayParent(): HTMLElement | null {
        return (document.querySelector('.watch-video--player-view') as HTMLElement | null)
            ?? (document.querySelector('.watch-video') as HTMLElement | null)
            ?? document.querySelector('video')?.parentElement
            ?? null;
    }

    seekVideo(time: number): void {
        // Seek ONLY through Netflix's player API (via the MAIN-world hook). Netflix
        // plays DRM content through a MediaSource it manages itself — writing
        // video.currentTime directly desyncs its SourceBuffer and crashes playback
        // with error M7375. So there is deliberately no currentTime fallback here.
        window.postMessage({ type: 'NFLX_SEEK', time }, '*');
    }

    reprocessCurrentVideo(): void {
        this.loadedForMovie = null;
        this.resetForNewVideo();
        this.queryManifest();
    }

    // Ask the MAIN-world hook for THIS title's manifest. Naming the movieId
    // matters: without it the hook can only offer its most recent capture, which
    // on a slow-loading title is still the previous title's manifest — handleManifest
    // would discard it and the retry would be a no-op (see the hook's cache note).
    //
    // Off a /watch page there is no title to ask about, and an unnamed query is
    // worse than none: the hook answers with its newest capture, i.e. the title
    // the user just left.
    queryManifest(): void {
        const movieId = this.getVideoId();
        if (!movieId) return;
        window.postMessage({ type: 'NFLX_QUERY', movieId }, '*');
    }

    setNativeSubtitlesEnabled(enabled: boolean): void {
        // Drive Netflix's own timed-text track via the MAIN-world player API
        // (the CSS overlay-hide is a fallback; Netflix's caption container class
        // is not stable). Only the "turn off" direction is honored — see the
        // hook. Netflix may not have a player session yet on first paint, so this
        // is best-effort and re-fires on every refresh() while the overlay is on.
        window.postMessage({ type: 'NFLX_SET_NATIVE_SUBS', enabled }, '*');
    }

    startSite(): void {
        // Tracks + fetched WebVTT arrive from the MAIN-world hook.
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const d = event.data;
            if (!d) return;
            if (d.type === 'NFLX_MANIFEST') {
                this.handleManifest(String(d.movieId), d.tracks as NetflixRawTrack[]);
            } else if (d.type === 'NFLX_VTT_RESULT' && typeof d.key === 'string') {
                this.handleVttResult(d.key, d.text || '', {
                    status: typeof d.status === 'number' ? d.status : undefined,
                    error: typeof d.error === 'string' ? d.error : undefined,
                });
            }
        });

        // Netflix is a SPA with no reliable navigation event — poll the URL for
        // title changes (same approach as the YouTube detector's fallback).
        let lastId = this.getVideoId();
        setInterval(() => {
            const id = this.getVideoId();
            if (id !== lastId) {
                lastId = id;
                this.currentMovieId = id;
                this.loadedForMovie = null;
                this.resetNoSubsRetries();
                this.resetForNewVideo();
                this.updateSidebarVisibility();
                this.queryManifest();
            }
        }, 1000);

        // Ask the hook for any manifest already captured (direct load onto /watch,
        // where the manifest may have been parsed before this script attached).
        this.queryManifest();
    }

    // ── manifest → track fetch ──────────────────────────────────────────────
    handleManifest(movieId: string, rawTracks: NetflixRawTrack[]): void {
        if (!movieId || !Array.isArray(rawTracks)) return;
        const urlId = this.getVideoId();
        console.log('[NFLX-VTT] manifest for', movieId, '(url id', urlId, ') raw tracks:', rawTracks.length);
        if (!isManifestForCurrentTitle(movieId, urlId)) {
            console.log('[NFLX-VTT] ignoring manifest — movieId != url id');
            return;
        }
        this.currentMovieId = movieId;
        if (this.loadedForMovie === movieId) return;

        // First-run gate: wait for a language pair before fetching anything.
        if (!this.langPrefs) {
            console.log('[NFLX-VTT] no language pair yet → onboarding');
            this.showLanguageOnboarding();
            return;
        }

        const tracks = normalizeTracks(rawTracks);
        this.currentTracks = tracks;
        console.log('[NFLX-VTT] webvtt tracks:', tracks.map((t) => t.language), '| pair:', this.langPrefs);

        // Drive the settings-panel dropdowns as language pickers: full catalog
        // split into "this title offers" vs "other" (see buildLanguageCatalog).
        // Seed the selection from the user's language pair.
        this.state.languageCatalog = buildLanguageCatalog(tracks);
        this.state.selectedLearningCode = baseLang(this.langPrefs.learning);
        this.state.selectedNativeCode = baseLang(this.langPrefs.native);

        const plan = planNetflixTracks(this.langPrefs, tracks, movieId);
        if (!plan) {
            // Title has no subtitles in either chosen language (no MT to fall back
            // on, unlike YouTube). The picker still lists what the title offers so
            // the user can switch to an available language.
            console.log('[NFLX-VTT] no track for chosen pair; available base codes:', [...new Set(tracks.map((t) => t.base))]);
            this.ui.refresh();
            // planNetflixTracks() returns null both when the pair misses AND
            // when normalizeTracks() dropped everything (no WebVTT downloads) —
            // the track count is what tells those two stories apart.
            this.declareNoSubtitles(tracks.length === 0 ? 'no-tracks' : 'no-language-match');
            return;
        }
        this.loadedForMovie = movieId;

        // Reflect which languages the plan actually resolved (may differ from the
        // raw pref when only one side is available), so the dropdowns match the
        // loaded tracks.
        const learningTrack = trackForBaseCode(tracks, this.langPrefs.learning);
        const nativeTrack = trackForBaseCode(tracks, this.langPrefs.native);
        if (learningTrack) this.state.selectedLearningCode = learningTrack.base;
        if (nativeTrack) this.state.selectedNativeCode = nativeTrack.base;

        // Keep AppState's primary/secondary aligned with the plan's labels (WebVTT
        // responses arrive asynchronously and possibly out of order).
        this.state.setLanguagePreferences(plan.primaryLabel, plan.secondaryLabel);
        for (const req of plan.requests) {
            this.pendingRequests.set(req.key, req.name);
            console.log('[NFLX-VTT] FETCH_VTT ->', req.name);
            window.postMessage({ type: 'NFLX_FETCH_VTT', key: req.key, url: req.url }, '*');
        }
    }

    handleVttResult(
        key: string,
        text: string,
        outcome: { status?: number; error?: string } = {},
    ): void {
        const name = this.takePending(key);
        console.log('[NFLX-VTT] VTT_RESULT <-', name, 'bytes:', text?.length ?? 0);
        if (!name) return;

        // A failed fetch used to end here silently: takePending() had already
        // dropped the key, parseVTT('') returned zero cues, and addParsedTrack()
        // bails on an empty array — so nothing was recorded, no subs_partial or
        // subs_rate_limited could fire, and the 12s pending backstop could no
        // longer see it either. A throttled Netflix track was indistinguishable
        // from a title that simply has no subtitles.
        if (outcome.status !== undefined || outcome.error !== undefined) {
            // Same vocabulary as YouTube: a 429 means the same thing on both.
            const failure =
                outcome.status === undefined
                    ? 'network'
                    : classifyStatus(outcome.status, false) ?? 'unknown';
            console.log('[NFLX-VTT] failed', name, failure, 'status:', outcome.status ?? 0);
            this.noteTrackFailure(name, { failure, status: outcome.status, attempts: 1 });
            return;
        }

        // parseVTT strips markup tags; decode the HTML entities it leaves behind.
        const subs = parseVTT(text).map((s) => ({ ...s, text: decodeEntities(s.text) }));
        console.log('[NFLX-VTT] parsed subs:', subs.length, 'for', name);
        this.addParsedTrack(name, subs);
    }

    // ── on-demand language switch (settings-panel picker) ───────────────────
    // The user picked a language for the learning/native slot. Netflix ships no
    // machine translation, so only languages the title actually offers can be
    // loaded — the picker already disables the rest. Fetch the chosen language's
    // WebVTT (if not already loaded) and point that slot's label preference at
    // it so AppState routes it to the right dropdown.
    requestLanguageTrack(role: TrackRole, code: string): void {
        const track = trackForBaseCode(this.currentTracks, code);
        if (!track) {
            // Should not happen — disabled options aren't selectable — but guard
            // rather than fetch a bogus URL.
            console.warn('[NFLX-VTT] requestLanguageTrack: no track for', code);
            return;
        }
        // Track display name matches planNetflixTracks' convention so AppState's
        // label-based slot matching keeps working.
        const label = labelForLanguage(code);

        // Point this slot's label preference at the chosen language. If both
        // slots end up on the same language, AppState.applyPreferences detects
        // the collision (secIndex === primIndex) and keeps the other slot on a
        // distinct track rather than showing the same subtitles twice.
        if (role === 'learning') {
            this.state.setLanguagePreferences(label, this.state.secondaryLangLabel);
        } else {
            this.state.setLanguagePreferences(this.state.primaryLangLabel, label);
        }

        // Already loaded? applyPreferences (run by setLanguagePreferences) has
        // already re-pointed the slot; just repaint.
        const existing = this.state.tracks.find((t) => t.name === label);
        if (existing) {
            this.ui.refresh();
            return;
        }

        // Fetch it. addParsedTrack → applyPreferences will slot it once it lands.
        const key = `${this.currentMovieId ?? 'nflx'}:${label}:${code}`;
        this.pendingRequests.set(key, label);
        console.log('[NFLX-VTT] on-demand FETCH_VTT ->', label);
        window.postMessage({ type: 'NFLX_FETCH_VTT', key, url: track.webvttUrl! }, '*');
    }
}

// In the browser-width ("windowed") player, shrinking .watch-video by the sidebar
// width moves the video into its own column so it isn't hidden behind the panel —
// and Netflix's control bar (a child of .watch-video) shrinks with it, staying
// clear of the sidebar. Only while the sidebar is expanded (not collapsed / not
// fullscreen), else the video reclaims the full width.
//
// Opaque panel in the windowed player; keep the shared frosted translucency in
// fullscreen (where it overlays the video and the see-through look is wanted).
function injectNetflixLayout(): void {
    const style = document.createElement('style');
    style.id = 'nflx-vtt-layout';
    style.textContent = `
        body.vtt-sidebar-active:has(#vtt-sidebar:not(.collapsed):not(.fullscreen)) .watch-video {
            width: calc(100vw - 320px) !important;
        }
        /* Not animated, for the same reason as YouTube's ytd-app (see
           injectLayoutOverrides in ../index.ts): transitioning width here
           relayouts and repaints the player tree every frame, over playing
           video. The sidebar's own transform slide carries the motion. */
        #vtt-sidebar:not(.fullscreen) {
            background-color: rgba(18, 18, 20, 0.98) !important;
        }
        /* In fullscreen, lift the panel's bottom clear of Netflix's control bar
           (CC / speed / exit-fullscreen) — the shared 75px gap is too small for it.
           Netflix scales its control bar with the viewport, so use a viewport-
           relative gap (12vh) with a 120px floor: it grows on big monitors and
           never drops below 120px on small ones. Round the bottom-left corner so
           it reads as a floating panel. */
        #vtt-sidebar.fullscreen {
            height: calc(100vh - max(120px, 12vh)) !important;
            border-bottom-left-radius: 12px;
        }
        ${SIDEBAR_CHROME_CSS}
    `;
    (document.head || document.documentElement).appendChild(style);
}

export function bootstrapNetflix(): NetflixVttApp {
    injectNetflixLayout();
    return new NetflixVttApp();
}
