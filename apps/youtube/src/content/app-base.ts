import {
    AppState,
    SidebarUI,
    AppInterface,
    loadLanguagePrefs,
    saveLanguagePrefs,
    onLanguagePrefsChanged,
    labelForLanguage,
    shortCodeForLanguage,
    msg as i18nMsg,
    OncePerScope,
    platformOf,
    type Platform,
    trackVia,
    fetchAndRenderNotification,
    watchForOrphanedContext,
    SUPPORTED_LANGUAGES,
    LanguagePrefs,
    Subtitle,
} from '@video-transcripts/shared';
import type { VttFailure } from './timedtext-fetch';

/**
 * Everything known about one failed track request. Wider than the bare
 * VttFailure it replaced because the diagnostics events need to distinguish
 * "YouTube throttled us, retried 4 times, asked for 30s" from "no translation
 * exists for this pair" — outwardly identical, but fixed in completely
 * different ways.
 */
export interface TrackFailureInfo {
    failure: VttFailure;
    status?: number;
    attempts?: number;
    /** Which escalation window the fetcher's breaker was on, if it opened. */
    breakerStep?: number;
    /** When this failure was recorded — feeds the recovery event's waited_s. */
    at: number;
}

/**
 * Why declareNoSubtitles() was called when NO fetch failure was recorded —
 * the caller knows structurally what the empty trackFailures map cannot say:
 *
 *  - 'no-tracks'          the site confirmed the video has no caption tracks
 *  - 'no-language-match'  tracks exist, but none in the learning/native pair
 *  - 'not-attempted'      the grace period expired before anything was tried
 *  - 'timeout'            requests were in flight but never answered
 *
 * A recorded real failure always outranks the cause (see declareNoSubtitles):
 * "nothing loaded because we were rate-limited" beats "nothing loaded".
 * The first two are expected absence, not defects — the GA4 `failure`
 * dimension exists precisely to keep them out of the breakage numbers.
 */
export type NoSubsCause = 'no-tracks' | 'no-language-match' | 'not-attempted' | 'timeout';

/** A button in the status banner. `disabled` renders it inert but readable. */
export interface StatusAction {
    label: string;
    onClick: () => void;
    emergency?: boolean;
    disabled?: boolean;
}

/** How a reprocessCurrentVideo() run should differ from a full video change. */
export interface ReprocessOptions {
    /**
     * Keep already-loaded tracks (and the user's guess progress) instead of
     * wiping state. Set on every retry: a retry exists to fill in what's
     * missing, and clearing a playing track to re-ask for it traded working
     * subtitles for an empty panel whenever the refetch was refused.
     */
    preserveTracks?: boolean;
    /**
     * Fetch with a single attempt instead of the full retry burst. Set by the
     * automatic post-cooldown retry: an unattended probe against an endpoint
     * that recently throttled us must not fire MAX_ATTEMPTS requests and give
     * YouTube fresh reasons to keep the limit up.
     */
    probe?: boolean;
}

/**
 * How many times an expired throttle cooldown may auto-retry unattended before
 * recovery goes back to being manual-only. Two probes ride the breaker's
 * escalating windows (~30s, then ~60s) — enough to pick up the common short
 * throttle without a click, few enough to stay polite when the limit is real
 * and long.
 */
export const AUTO_PROBE_LIMIT = 2;

/**
 * How long the emergency "Reload page" diagnostic may delay the reload.
 *
 * Exported so a test can assert the budget rather than hard-code it: the value
 * is the whole feature. Too small and the report never leaves (an MV3 worker
 * has to cold-start, refresh a token and reach Firestore first); too large and
 * the user waits on a button that promised a reload.
 */
export const REPORT_NO_SUBS_TIMEOUT_MS = 2500;

// Localized UI string with an English fallback. Delegates to the shared helper
// (honors any demo override, then chrome.i18n, then the fallback).
function t(key: string, fallback: string): string {
    return i18nMsg(key, fallback);
}

// Site-agnostic styling for the sidebar chrome the base app injects (language
// onboarding, the searching/no-subtitles status banner, the language-pair chip).
// Both the YouTube and Netflix layout overrides splice this in so the two sites
// share identical panel styling; only the page-reflow rules differ per site.
export const SIDEBAR_CHROME_CSS = `
    /* Orphaned-context notice: the extension was reloaded (a store auto-update,
       or a rebuild in development) and this content script can no longer reach
       the worker, so the transcript has stopped following the video.

       order:-1 pins it above the header instead of letting it sit in the flow:
       everything below is stale, and the message has to be the first thing read
       whichever screen the panel was left on. Amber, not the emergency red of
       "Reload page" below — nothing is lost, and one reload undoes it. */
    #vtt-orphan-notice {
        order: -1;
        flex: 0 0 auto;
        margin: 4px 16px 10px;
        padding: 10px 13px 11px;
        border-left: 2px solid #ffa257;
        border-radius: 4px;
        background: rgba(255, 162, 87, 0.14);
        font-size: 11px;
        line-height: 1.45;
    }
    .vtt-orphan-notice-title {
        font-size: 12px;
        font-weight: 600;
        color: #ffa257;
    }
    .vtt-orphan-notice-text {
        margin-top: 2px;
        color: rgba(255, 255, 255, 0.72);
    }
    .vtt-orphan-notice-action {
        margin-top: 9px;
        padding: 5px 11px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: #f3f4f6;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
    }
    .vtt-orphan-notice-action:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    #vtt-lang-onboarding {
        margin: 16px;
        padding: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: #e5e7eb;
    }
    #vtt-lang-onboarding .vtt-lang-onboarding-title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 6px;
    }
    #vtt-lang-onboarding .vtt-lang-onboarding-text {
        font-size: 12px;
        line-height: 1.5;
        color: #9ca3af;
        margin-bottom: 14px;
    }
    #vtt-lang-onboarding .vtt-lang-onboarding-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
    }
    #vtt-lang-onboarding .vtt-lang-onboarding-row span {
        font-size: 12px;
        color: #cbd5e1;
    }
    #vtt-lang-onboarding select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: #1f1f1f;
        color: #f3f4f6;
        font-size: 13px;
    }
    #vtt-status {
        margin: 16px;
        padding: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: #e5e7eb;
    }
    #vtt-status .vtt-empty-state-title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 6px;
    }
    #vtt-status .vtt-empty-state-text {
        font-size: 12px;
        line-height: 1.5;
        color: #9ca3af;
    }
    #vtt-status .vtt-empty-state-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-top: 12px;
    }
    #vtt-status .vtt-empty-state-action {
        padding: 6px 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: #f3f4f6;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    #vtt-status .vtt-empty-state-action:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    /* "Reload page" is an emergency escape hatch, not a feature: quiet red
       outline, no fill, no brand accent. */
    #vtt-status .vtt-empty-state-action.vtt-empty-state-action--emergency {
        border-color: rgba(248, 113, 113, 0.4);
        color: #f87171;
        background: rgba(239, 68, 68, 0.08);
    }
    #vtt-status .vtt-empty-state-action.vtt-empty-state-action--emergency:hover {
        border-color: rgba(248, 113, 113, 0.6);
        background: rgba(239, 68, 68, 0.16);
    }
    /* Header-left slot, the mirror of the settings gear on the right; the
       centered title sits between them, and #vtt-header-top's align-items
       centers the chip vertically (absolute children take their static
       position). It's a button (swaps the pair), so block the text selection
       the sidebar forces on for transcript quick-add. */
    #vtt-langpair {
        display: flex;
        position: absolute;
        left: 16px;
        min-width: 0;
        -webkit-user-select: none;
        user-select: none;
    }
    #vtt-langpair .vtt-langpair-inner {
        display: inline-flex;
        align-items: center;
        /* Always read learning → native left-to-right, even when the sidebar
           is RTL (which would otherwise flip the flex order). */
        direction: ltr;
        gap: 8px;
        padding: 5px 13px;
        border-radius: 999px;
        background: rgba(124, 90, 255, 0.16);
        border: 1px solid rgba(124, 90, 255, 0.32);
        font-size: 12px;
        font-weight: 600;
        color: #e3e5ff;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
        max-width: 100%;
        min-width: 0;
    }
    #vtt-langpair .vtt-langpair-lang {
        display: inline-flex;
        align-items: center;
    }
    #vtt-langpair .vtt-langpair-inner:hover {
        background: rgba(124, 90, 255, 0.28);
        border-color: rgba(124, 90, 255, 0.55);
    }
    #vtt-langpair:focus-visible { outline: none; }
    #vtt-langpair:focus-visible .vtt-langpair-inner {
        border-color: rgba(124, 90, 255, 0.75);
        box-shadow: 0 0 0 2px rgba(124, 90, 255, 0.35);
    }
    #vtt-langpair .vtt-langpair-arrow { opacity: 0.5; margin: 0 1px; }
`;

/**
 * Site-agnostic sidebar app: language onboarding, the "searching / no subtitles"
 * status flow, the language-pair chip, subtitle-track bookkeeping, playback-time
 * highlighting, and keyboard shortcuts. Everything that differs per streaming
 * site (how a video is identified, how caption tracks are discovered/fetched,
 * how the player seeks, where the on-video overlay mounts) is left abstract for
 * a subclass to provide.
 */
export abstract class BaseVttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    pendingRequests: Map<string, string> = new Map();
    langPrefs: LanguagePrefs | null = null;
    noSubsTimer: number | null = null;
    // Separate from noSubsTimer: that one only guards the all-empty case.
    pendingTrackTimer: number | null = null;
    /** Debounce for subtitles_loaded, so track_count counts every track. */
    subsLoadedTimer: number | null = null;
    // How many times the user has hit "Search again" for the current no-subs
    // banner without any track showing up. Once they've retried and it's still
    // empty, we offer a page reload as the next fallback. Reset when a track
    // finally loads or the video changes.
    noSubsRetries: number = 0;
    // Why each requested track failed, keyed by display name. Lets the UI say
    // "YouTube throttled us" instead of "this video has no subtitles".
    // Carries the HTTP status / attempt count alongside the verdict so the
    // diagnostics events can report *how* it failed, not just *that* it did —
    // by the time declareNoSubtitles() runs, the original message is long gone.
    trackFailures: Map<string, TrackFailureInfo> = new Map();
    // Set while a search was deliberately NOT run (Shorts with the panel
    // collapsed). It has to outlive scheduleNoSubtitlesCheck(), which runs on
    // every resetForNewVideo() and would otherwise repaint "No subtitles
    // available" over the offer — a verdict on a search that never happened,
    // and a false one: the catalogue is what told us there ARE captions.
    // Cleared on a real video change and once a search actually runs.
    searchDeferred: boolean = false;
    // Absolute epoch ms until which the fetcher's rate-limit breaker is open.
    cooldownUntil: number = 0;
    // Ticks the cooldown countdown in the banner while it runs.
    cooldownTimer: number | null = null;
    // Unattended retries fired for the current throttle episode; capped at
    // AUTO_PROBE_LIMIT. Reset when a video changes or everything loads.
    autoProbes: number = 0;

    // ── analytics bookkeeping ───────────────────────────────────────────────
    // One-shots for the per-video events. Reset from resetNoSubsRetries(), NOT
    // resetForNewVideo(): the latter also runs inside reprocessCurrentVideo()
    // ("Search again"), so resetting there would re-arm every event on each
    // manual retry and report one video several times. Same line the codebase
    // already draws for cooldownUntil.
    analyticsOnce = new OncePerScope();
    // Whether anything failed during this video, and when the first failure
    // landed. Both must outlive resetForNewVideo() — which clears
    // trackFailures — or a retry would erase the evidence that a recovery
    // event is due, and there would be nothing to measure "waited_s" from.
    hadFailures: boolean = false;
    firstFailureAt: number = 0;
    // The failure value the no_subtitles event reported for this video, kept so
    // the emergency-reload diagnostic can reuse it after resetForNewVideo() has
    // cleared trackFailures. Survives "Search again" for the same reason
    // hadFailures does; cleared in resetNoSubsRetries() on a real video change.
    lastNoSubsFailure: string | null = null;
    // Set by the retry paths so a recovery can say whether it was the user or
    // the auto-probe that fixed it.
    lastRecoveryTrigger: 'auto_probe' | 'manual_retry' | 'late_arrival' = 'late_arrival';

    constructor() {
        this.state = new AppState();
        this.ui = new SidebarUI(this.state, this);
    }

    // ── site hooks (subclass provides) ──────────────────────────────────────
    /** The id of the video currently in the URL, or null when off a watch page. */
    abstract getVideoId(): string | null;
    /** Element the dual-subtitle overlay should mount into (the player). */
    abstract getOverlayParent(): HTMLElement | null;
    /** Move playback to `time` seconds. */
    abstract seekVideo(time: number): void;
    /** Re-discover and re-fetch caption tracks for the current video. */
    abstract reprocessCurrentVideo(opts?: ReprocessOptions): void;
    /** Start site-specific caption detection (called once, after init()). */
    abstract startSite(): void;
    /** Whether an ad is currently playing (suppresses highlight/seek). */
    isAdPlaying(): boolean {
        return false;
    }

    // False when a #vtt-sidebar already exists on the page — i.e. another
    // installed copy of the extension (old CWS version alongside a dev build)
    // or a stale injection owns it. Every UI writer must bail then: the ids
    // match ours, so without the guard we'd graft controls into a sidebar we
    // didn't build (observed as a franken-UI of old panel + new chip).
    // Public so the bootstrap can also gate page-level installers (auth badge).
    uiOwned = true;

    // Common bootstrap: build the sidebar, set visibility, wire shortcuts.
    // Subclasses call this from their constructor AFTER their own fields exist.
    protected init(): void {
        this.uiOwned = this.ui.init();
        if (!this.uiOwned) {
            console.warn('[Lingogram] Another #vtt-sidebar owns this page (second extension copy?) — this copy keeps its UI off.');
            return;
        }
        this.updateSidebarVisibility();
        this.setupKeyboardShortcuts();
        // Remote notification, if one is published for this version/platform/
        // locale. Fired here rather than from updateOnboardingState() so it
        // also reaches users who have not picked languages yet — an outage
        // announcement is exactly what a stuck new user needs to see. Async and
        // unawaited: the banner appears when it appears, and a failed lookup
        // shows nothing.
        void fetchAndRenderNotification(platformOf(location.hostname));
        // An extension reload (a store auto-update mid-video, or a rebuild in
        // development) orphans this content script: the sidebar and its parsed
        // tracks stay on screen, but nothing can reach the worker any more, so
        // no new track ever loads and saving a word fails. This edition
        // highlights from its own timeupdate handler, so the transcript keeps
        // scrolling and the panel looks entirely healthy — which is exactly why
        // the state has to be announced rather than left to be inferred.
        // Reached only past the #vtt-sidebar ownership guard above, so the
        // notice always has a panel of ours to render into.
        watchForOrphanedContext();
    }

    // ── language prefs ──────────────────────────────────────────────────────
    async initLanguagePrefs(): Promise<void> {
        this.langPrefs = await loadLanguagePrefs();
        this.applyLangPrefsToState();
        this.updateOnboardingState();

        onLanguagePrefsChanged((prefs) => {
            this.langPrefs = prefs;
            this.applyLangPrefsToState();
            this.updateOnboardingState();
            // Apply newly-chosen languages to the video already on screen.
            if (prefs) this.reprocessCurrentVideo();
        });
    }

    applyLangPrefsToState(): void {
        if (!this.langPrefs) return;
        this.state.setLanguagePreferences(
            labelForLanguage(this.langPrefs.learning),
            labelForLanguage(this.langPrefs.native),
        );
    }

    updateOnboardingState(): void {
        if (!this.uiOwned) return;
        this.updateLanguagePairChip();
        if (this.langPrefs) {
            this.hideLanguageOnboarding();
            this.scheduleNoSubtitlesCheck();
        } else {
            this.clearNoSubtitlesTimer();
            this.hideStatusBanner();
            this.showLanguageOnboarding();
        }
    }

    // An "EN ⇄ RU" chip at the header's left edge (mirroring the settings gear
    // on the right) reflecting the chosen pair, so it's always clear which two
    // languages are in play.
    updateLanguagePairChip(): void {
        // Mount ONLY into our own header slot, no fallbacks: the ids are
        // shared across extension versions, so a fallback would graft the
        // chip into a sidebar built by another installed copy.
        const headerTop = document.getElementById('vtt-header-top');
        const existing = document.getElementById('vtt-langpair');
        if (!this.langPrefs) {
            existing?.remove();
            return;
        }
        const { learning, native } = this.langPrefs;
        const chip = (existing as HTMLElement) ?? document.createElement('div');
        chip.id = 'vtt-langpair';
        // Compact abbreviations, no flags (EN ⇄ RU); each language is one span
        // so the .vtt-swapped row-reverse flip reorders them cleanly. The
        // bidirectional arrow advertises that the chip itself swaps.
        chip.innerHTML =
            '<span class="vtt-langpair-inner">' +
            `<span class="vtt-langpair-lang">${shortCodeForLanguage(learning)}</span>` +
            '<span class="vtt-langpair-arrow">⇄</span>' +
            `<span class="vtt-langpair-lang">${shortCodeForLanguage(native)}</span>` +
            '</span>';
        // The chip IS the swap control: tapping the pair swaps which track is
        // primary, and .vtt-swapped (set in updateControls) flips the visual
        // order to match. Language changes live behind the settings gear.
        if (!existing) {
            const label = `${t('ytModeSwap', 'Swap')} (Shift+S)`;
            chip.setAttribute('role', 'button');
            chip.setAttribute('tabindex', '0');
            chip.setAttribute('aria-label', t('ytModeSwap', 'Swap'));
            chip.title = label;
            const swap = () => {
                if (!this.state.swapTracks()) return;
                chip.classList.remove('vtt-pulse');
                void chip.offsetWidth;
                chip.classList.add('vtt-pulse');
                this.ui.refresh();
            };
            chip.addEventListener('click', swap);
            chip.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    swap();
                }
            });
        }
        if (!existing && headerTop) headerTop.prepend(chip);
    }

    showLanguageOnboarding(): void {
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar || document.getElementById('vtt-lang-onboarding')) return;

        // After the early return, so this counts banners actually shown rather
        // than calls made. The gap between this and languages_configured is the
        // first suspected funnel hole.
        this.analyticsOnce.fire('onboarding_shown', () => {
            trackVia('onboarding_shown', { site: platformOf(location.hostname) });
        });

        const banner = document.createElement('div');
        banner.id = 'vtt-lang-onboarding';
        banner.className = 'vtt-lang-onboarding';

        const title = document.createElement('div');
        title.className = 'vtt-lang-onboarding-title';
        title.textContent = t('ytOnboardingTitle', 'Choose your languages');
        banner.appendChild(title);

        const text = document.createElement('div');
        text.className = 'vtt-lang-onboarding-text';
        text.textContent = t(
            'ytOnboardingText',
            "Pick the language you're learning and your native language to start.",
        );
        banner.appendChild(text);

        const learning = this.buildOnboardingSelect(t('ytLearningLabel', "I'm learning"));
        const native = this.buildOnboardingSelect(t('ytNativeLabel', 'My native language'));
        banner.appendChild(learning.wrap);
        banner.appendChild(native.wrap);

        const persist = () => {
            const l = learning.select.value;
            const n = native.select.value;
            if (!l || !n) return; // both required
            void saveLanguagePrefs({ learning: l, native: n }, 'onboarding');
        };
        learning.select.addEventListener('change', persist);
        native.select.addEventListener('change', persist);

        // Place it at the top of the content area (under the header) so it's the
        // first thing the user sees, not pinned to the bottom of an empty list.
        const list = document.getElementById('vtt-list');
        if (list) sidebar.insertBefore(banner, list);
        else sidebar.appendChild(banner);
    }

    buildOnboardingSelect(labelText: string): { wrap: HTMLElement; select: HTMLSelectElement } {
        const wrap = document.createElement('label');
        wrap.className = 'vtt-lang-onboarding-row';

        const span = document.createElement('span');
        span.textContent = labelText;
        wrap.appendChild(span);

        const select = document.createElement('select');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = t('ytSelectPlaceholder', 'Select…');
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        for (const lang of SUPPORTED_LANGUAGES) {
            const opt = document.createElement('option');
            opt.value = lang.code;
            // Endonym only (e.g. "Español", "中文") so the picker reads naturally
            // in any UI locale instead of prefixing the English language name.
            opt.textContent = lang.native;
            select.appendChild(opt);
        }
        wrap.appendChild(select);
        return { wrap, select };
    }

    hideLanguageOnboarding(): void {
        document.getElementById('vtt-lang-onboarding')?.remove();
    }

    // ── "searching / no subtitles" status flow ──────────────────────────────
    // While fetching for a video we show a "Searching…" status so the sidebar is
    // never blank. If nothing usable arrives within the grace period it flips to
    // "No subtitles". Cleared as soon as a track loads, the video changes, or
    // onboarding is showing.
    scheduleNoSubtitlesCheck(graceMs: number = 7000): void {
        this.clearNoSubtitlesTimer();
        // A deferred search is not a search in progress. page-script re-sends
        // the track list several times per video, so each round would repaint
        // "Searching…" over the offer and re-arm the timer that concludes "No
        // subtitles available" — about a fetch that was never issued.
        if (this.searchDeferred) return;
        this.hideStatusBanner();
        if (!this.langPrefs) return;
        if (this.getVideoId() === null) return;
        if (this.state.tracks.length > 0) return; // already have something to show

        this.showStatusBanner(
            t('ytSearchingTitle', 'Searching for subtitles…'),
            t('ytSearchingText', 'Looking for captions for this video.'),
        );

        this.noSubsTimer = window.setTimeout(() => {
            this.noSubsTimer = null;
            if (!this.langPrefs) return;
            if (this.getVideoId() === null) return;
            if (this.state.tracks.length === 0) {
                // Requests still in flight mean attempts WERE made — that is a
                // reply that never came, not a video nobody asked about.
                this.declareNoSubtitles(
                    this.pendingRequests.size > 0 ? 'timeout' : 'not-attempted',
                );
            }
        }, graceMs);
    }

    /**
     * Catches the request that never answers at all.
     *
     * scheduleNoSubtitlesCheck() bails once anything has loaded, and
     * trackFailures only gains an entry when a result actually comes back — so
     * a second track whose reply is lost (a wedged page-script, a dropped
     * postMessage) leaves the app in a silent half-loaded state: Dual is
     * disabled, no notice explains why, and nothing is recorded. This timer is
     * the only thing that makes that case observable.
     */
    schedulePendingTrackCheck(graceMs: number = 12_000): void {
        this.clearPendingTrackTimer();
        this.pendingTrackTimer = window.setTimeout(() => {
            this.pendingTrackTimer = null;
            if (this.getVideoId() === null) return;
            // Only interesting while something IS playing and something else is
            // still outstanding — the all-empty case is declareNoSubtitles'.
            if (this.state.tracks.length === 0) return;
            if (this.pendingRequests.size === 0) return;
            for (const name of this.pendingRequests.values()) {
                this.noteTrackFailure(name, { failure: 'timeout' });
            }
            this.pendingRequests.clear();
        }, graceMs);
    }

    clearPendingTrackTimer(): void {
        if (this.pendingTrackTimer !== null) {
            clearTimeout(this.pendingTrackTimer);
            this.pendingTrackTimer = null;
        }
    }

    /**
     * Reports subtitles_loaded once the tracks have stopped arriving.
     *
     * Each new track pushes the timer out, so the count reflects everything
     * that landed rather than whatever happened to be first. Measured gap
     * between the two tracks of a dual load is ~100ms; the window is much
     * larger than that so a slow second track still counts, and small enough
     * that a video abandoned early still reports.
     *
     * The one-shot is claimed only when the event is actually sent, so a
     * cancelled timer (video changed mid-flight) leaves it re-armed.
     */
    scheduleSubtitlesLoadedReport(site: Platform, settleMs: number = 1_500): void {
        if (this.analyticsOnce.hasFired('subtitles_loaded')) return;
        this.clearSubsLoadedTimer();
        this.subsLoadedTimer = window.setTimeout(() => {
            this.subsLoadedTimer = null;
            const count = this.state.tracks.length;
            if (count === 0) return;
            this.analyticsOnce.fire('subtitles_loaded', () => {
                trackVia('subtitles_loaded', { site, track_count: count });
            });
        }, settleMs);
    }

    clearSubsLoadedTimer(): void {
        if (this.subsLoadedTimer !== null) {
            clearTimeout(this.subsLoadedTimer);
            this.subsLoadedTimer = null;
        }
    }

    // Show the "no subtitles" notice now (used both by the grace-period timeout
    // and when the site reports a video has no caption tracks at all).
    declareNoSubtitles(cause?: NoSubsCause): void {
        this.clearNoSubtitlesTimer();
        if (!this.langPrefs) return;
        if (this.getVideoId() === null) return;
        if (this.state.tracks.length > 0) return;

        // The failure fields come from trackFailures rather than being
        // recomputed: by now the original fetch result is long gone, and
        // "nothing loaded" is far less actionable than "nothing loaded because
        // we were rate-limited after 4 attempts". When nothing was recorded,
        // the caller's cause fills the gap — never an empty string, which GA4
        // keeps as an undiagnosable bucket.
        this.analyticsOnce.fire('no_subtitles', () => {
            const worst = this.dominantFailure();
            const detail = [...this.trackFailures.values()].find((i) => i.failure === worst);
            const failure = worst ?? cause ?? 'unknown';
            this.lastNoSubsFailure = failure;
            trackVia('no_subtitles', {
                site: platformOf(location.hostname),
                retried: this.noSubsRetries > 0,
                failure,
                status: detail?.status ?? 0,
                attempts: detail?.attempts ?? 0,
                learning: this.langPrefs?.learning ?? '',
                native: this.langPrefs?.native ?? '',
            });
        });

        this.reportNativeCcMismatch(cause);

        // Throttled, not subtitle-less. Saying "this video has no subtitles"
        // here is simply false — the tracks exist, YouTube declined to serve
        // the request — and it sends the user off to another video for nothing.
        if (this.isThrottled()) {
            const remaining = this.cooldownRemainingMs();
            this.showStatusBanner(
                t('ytThrottledTitle', 'YouTube is limiting requests'),
                t(
                    'ytThrottledText',
                    'YouTube temporarily blocked the subtitle request for this video. ' +
                        "It's a limit on their side, not a missing subtitle — it can clear in minutes, but sometimes lasts hours.",
                ),
                remaining > 0
                    ? [
                          {
                              label: t('ytRetryInSeconds', 'Try again in {s}s').replace(
                                  '{s}',
                                  String(Math.ceil(remaining / 1000)),
                              ),
                              onClick: () => {},
                              disabled: true,
                          },
                      ]
                    : [
                          {
                              label: '↻ ' + t('ytSearchAgain', 'Search again'),
                              onClick: () => this.retrySubtitleSearch(),
                          },
                      ],
            );
            if (remaining > 0) this.scheduleCooldownTick();
            return;
        }

        // A stale signed URL is recoverable by re-reading the player
        // response, which is exactly what "Search again" triggers.
        if (this.isRecoverableFailure()) {
            // ...but only when re-reading yields a DIFFERENT URL. The live
            // player response is cached in the player for the lifetime of the
            // page, so when its signed URLs are the dead ones, every retry
            // re-sends the identical request and gets the identical empty
            // answer. The user is then stuck clicking a button that structurally
            // cannot work, with no way out offered — the reload escalation lived
            // below this early return and so never appeared here. Once they have
            // retried and it is still empty, surface the same emergency reload
            // the no-subtitles branch offers; only a page load re-mints the URLs.
            const retryActions: StatusAction[] = [
                {
                    label: '↻ ' + t('ytSearchAgain', 'Search again'),
                    onClick: () => this.retrySubtitleSearch(),
                },
            ];
            if (this.noSubsRetries > 0) {
                retryActions.push({
                    label: '⟳ ' + t('ytReloadPage', 'Reload page'),
                    onClick: () => void this.reportNoSubsAndReload(),
                    emergency: true,
                });
            }
            this.showStatusBanner(
                t('ytLoadFailedTitle', "Couldn't load subtitles"),
                this.noSubsRetries > 0
                    ? t(
                          'ytLoadFailedRetryText',
                          'Searching again did not help. Reloading the page refreshes the ' +
                              'subtitle link and usually fixes it.',
                      )
                    : t(
                          'ytLoadFailedText',
                          'The subtitle link expired. Searching again usually fixes it.',
                      ),
                retryActions,
            );
            return;
        }
        // First time we come up empty: offer "Search again" (the normal recovery
        // path). If the user already retried and subtitles still didn't load,
        // additionally surface a quiet, red "Reload page" emergency button — a
        // last-resort escape hatch, deliberately NOT styled as a feature.
        const actions: StatusAction[] = [
            {
                label: '↻ ' + t('ytSearchAgain', 'Search again'),
                onClick: () => this.retrySubtitleSearch(),
            },
        ];
        if (this.noSubsRetries > 0) {
            actions.push({
                label: '⟳ ' + t('ytReloadPage', 'Reload page'),
                onClick: () => void this.reportNoSubsAndReload(),
                emergency: true,
            });
        }
        this.showStatusBanner(
            t('ytNoSubsTitle', 'No subtitles available'),
            this.noSubsRetries > 0
                ? t(
                      'ytNoSubsRetryText',
                      "Still no subtitles. Reloading the page often fixes it.",
                  )
                : t(
                      'ytNoSubsText',
                      "This video doesn't have subtitles. Try another video — not every " +
                          'video has captions.',
                  ),
            actions,
        );
    }

    /**
     * Ask the page whether the site's OWN caption control says this video has
     * captions. Answered asynchronously because on YouTube the verdict lives in
     * the MAIN world (see nativeCcState in page-script.ts) behind a postMessage
     * round trip. The base implementation resolves 'unknown' — a site with no
     * native control to read must not be counted as either agreeing or
     * disagreeing with us.
     */
    queryNativeCc(): Promise<'yes' | 'no' | 'unknown'> {
        return Promise.resolve('unknown');
    }

    /**
     * Report the one case that is unambiguously OUR failure: the panel is empty
     * while the site's own caption button says captions exist.
     *
     * Kept apart from no_subtitles rather than folded in as a param, because
     * that event fires for the healthy "this video genuinely has no captions"
     * case too. Here, a hit always means a user who could have had subtitles and
     * didn't — so the count needs no filtering to be read as breakage.
     *
     * 'unknown' is dropped, never reported as a mismatch: the control renders
     * late and is missing entirely on some surfaces, so treating "couldn't read
     * it" as "captions exist" would manufacture breakage out of our own timing.
     * Shares the no_subtitles one-shot scope, so retries on one video cannot
     * report the same miss twice.
     */
    reportNativeCcMismatch(cause?: NoSubsCause): void {
        if (this.analyticsOnce.hasFired('subs_missed_with_cc')) return;
        const failureAtCall = this.dominantFailure() ?? cause ?? 'unknown';
        const detail = this.failureDetail();
        // The video this report is ABOUT. queryNativeCc() is a postMessage
        // round trip with a timeout, so it can outlive a navigation — and a
        // video change re-arms analyticsOnce and zeroes noSubsRetries, so the
        // late callback would sail through every guard and emit a row mixing
        // the old video's failure with the new video's prefs, while consuming
        // the new video's one-shot slot.
        const forVideo = this.getVideoId();
        void this.queryNativeCc()
            .then((state) => {
                if (state !== 'yes') return;
                if (this.getVideoId() !== forVideo) return;
                // Re-checked after the await: a track that landed while the
                // round trip was in flight means nothing was missed at all.
                if (this.state.tracks.length > 0) return;
                this.analyticsOnce.fire('subs_missed_with_cc', () => {
                    trackVia('subs_missed_with_cc', {
                        site: platformOf(location.hostname),
                        failure: failureAtCall,
                        status: detail?.status ?? 0,
                        attempts: detail?.attempts ?? 0,
                        retried: this.noSubsRetries > 0,
                        learning: this.langPrefs?.learning ?? '',
                        native: this.langPrefs?.native ?? '',
                    });
                });
            })
            .catch(() => {
                // Analytics must never break a user flow.
            });
    }

    /** Is the panel slid off-screen? Used to skip work nobody can see. */
    isSidebarCollapsed(): boolean {
        return this.ui.isCollapsed();
    }

    /**
     * Offer a search the caller declined to run on its own.
     *
     * Shorts with a collapsed panel skips fetching (see handleCaptionTracks),
     * so the panel must not simply sit empty when the user opens it: an empty
     * panel with no explanation reads as "this short has no subtitles", which
     * is the opposite of true — we know the catalogue lists some, that is why
     * this banner is offered at all.
     *
     * A button rather than an automatic fetch on expand: the user opening the
     * panel is not necessarily asking for THIS short, and spending the requests
     * unasked is the very thing the deferral exists to avoid.
     */
    offerDeferredSearch(): void {
        this.searchDeferred = true;
        this.clearNoSubtitlesTimer();
        this.showStatusBanner(
            t('ytDeferredTitle', 'Subtitles are ready to load'),
            t(
                'ytDeferredText',
                'The panel was closed, so nothing was downloaded for this video yet.',
            ),
            [
                {
                    label: '⌕ ' + t('ytFindSubtitles', 'Find subtitles'),
                    onClick: () => {
                        this.searchDeferred = false;
                        this.reprocessCurrentVideo();
                    },
                },
            ],
        );
    }

    // "Search again" handler: remember that the user retried (so the next empty
    // result can escalate to a reload prompt) and re-run site detection.
    // Always preserveTracks — a retry fills in what's missing; it must never
    // trade a playing track for an empty panel. Auto-retries (the post-cooldown
    // probe) don't count toward the reload-prompt escalation: that prompt is
    // about what the USER has already tried.
    retrySubtitleSearch(opts: { auto?: boolean } = {}): void {
        if (!opts.auto) this.noSubsRetries++;
        // Labels whichever recovery follows: it answers whether AUTO_PROBE_LIMIT
        // is set high enough, or whether people are having to click their way
        // out of every throttle.
        this.lastRecoveryTrigger = opts.auto ? 'auto_probe' : 'manual_retry';
        this.reprocessCurrentVideo({ preserveTracks: true, probe: opts.auto });
    }

    /**
     * Fire one unattended retry now that the cooldown expired, if the budget
     * allows. Returns whether a probe was launched. Deliberately conservative —
     * the user's worry is real: every request sent into an active limit is
     * fresh evidence for YouTube to keep throttling this client. So a probe is
     * a single attempt (no burst), only ever fired after the breaker's window
     * has fully elapsed, and only AUTO_PROBE_LIMIT times per episode; after
     * that the retry goes back to being a human decision.
     */
    maybeAutoProbe(): boolean {
        if (this.autoProbes >= AUTO_PROBE_LIMIT) return false;
        if (!this.isThrottled()) return false;
        if (!this.langPrefs || this.getVideoId() === null) return false;
        this.autoProbes++;
        this.retrySubtitleSearch({ auto: true });
        return true;
    }

    // Emergency "Reload page" handler. The banner copy qualifies the click
    // ("this video HAS subtitles but we aren't showing them"), so it doubles as
    // a bug report: fire a best-effort diagnostic to the background worker, then
    // reload no matter what. The race caps how long a slow/dead worker can delay
    // the reload the user actually asked for.
    //
    // The cap was 400ms. What that budget has to cover is not the message hop —
    // measured at 18-27ms to a cold worker — but everything addNoSubsReport does
    // before the write: ensureFreshToken() may spend a full securetoken
    // round-trip refreshing an expired ID token, and only then does the
    // Firestore commit go out. A single slow network round-trip overruns 400ms,
    // and when it does the report is lost silently, because the caller swallows
    // failures by design. 2500ms covers a refresh plus the commit and is still
    // far shorter than the page reload the user is already waiting through.
    async reportNoSubsAndReload(): Promise<void> {
        try {
            if (chrome?.runtime?.id) {
                await Promise.race([
                    chrome.runtime
                        .sendMessage({
                            action: 'REPORT_NO_SUBS',
                            site: location.hostname,
                            videoRef: this.getVideoId() ?? location.href,
                            version: chrome.runtime.getManifest().version,
                            locale: chrome.i18n.getUILanguage(),
                            // The chosen pair tells triage which subtitle
                            // languages failed to materialize. Always set:
                            // the no-subs banner only renders with prefs.
                            learning: this.langPrefs?.learning ?? '',
                            native: this.langPrefs?.native ?? '',
                            // The app already knows why; sending it turns
                            // "subtitles missing" into an actionable report.
                            // Same vocabulary as the no_subtitles event; the
                            // stored value covers the case where a "Search
                            // again" already cleared trackFailures.
                            failure: this.dominantFailure() ?? this.lastNoSubsFailure ?? 'unknown',
                            status: this.failureDetail()?.status ?? 0,
                            attempts: this.failureDetail()?.attempts ?? 0,
                            tracksLoaded: this.state.tracks.length,
                        })
                        .catch(() => undefined),
                    new Promise((resolve) => setTimeout(resolve, REPORT_NO_SUBS_TIMEOUT_MS)),
                ]);
            }
        } catch {
            // Extension context invalidated — the reload below fixes that too.
        }
        location.reload();
    }

    clearNoSubtitlesTimer(): void {
        if (this.noSubsTimer !== null) {
            clearTimeout(this.noSubsTimer);
            this.noSubsTimer = null;
        }
        this.clearCooldownTick();
        // NOTE: deliberately does NOT clear pendingTrackTimer. addParsedTrack()
        // calls this on the FIRST track, which is exactly the half-loaded state
        // the pending-track backstop exists to catch — cancelling it there made
        // it unreachable. Its own lifetime is resetForNewVideo() and the moment
        // pendingRequests empties out.
    }

    // Re-render the banner once a second so the cooldown counts down, and stop
    // as soon as it expires. On expiry, first offer the moment to the auto
    // probe — the user's two "wait ~30s, click, it loads" rounds were exactly
    // this timer reaching zero with nobody to press the button. If the probe
    // budget is spent, the last render swaps in a live "Search again" instead.
    // The partial notice (tracks playing) is deliberately NOT re-rendered every
    // tick: it shows no countdown, so each rebuild would only flicker its
    // tooltip out from under the cursor.
    scheduleCooldownTick(): void {
        if (this.cooldownTimer !== null) return;
        this.cooldownTimer = window.setInterval(() => {
            const expired = this.cooldownRemainingMs() <= 0;
            if (expired) {
                this.clearCooldownTick();
                if (this.maybeAutoProbe()) return; // reprocess re-renders everything
            }
            if (this.state.tracks.length === 0) this.declareNoSubtitles();
            else if (expired) this.updatePartialFailureNotice();
            this.ui.refresh();
        }, 1000);
    }

    clearCooldownTick(): void {
        if (this.cooldownTimer !== null) {
            clearInterval(this.cooldownTimer);
            this.cooldownTimer = null;
        }
    }

    showStatusBanner(
        titleText: string,
        bodyText: string,
        action?: StatusAction | StatusAction[],
    ): void {
        if (document.getElementById('vtt-lang-onboarding')) return; // onboarding wins
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return;

        let banner = document.getElementById('vtt-status');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'vtt-status';
            banner.className = 'vtt-empty-state';
            const title = document.createElement('div');
            title.className = 'vtt-empty-state-title';
            const text = document.createElement('div');
            text.className = 'vtt-empty-state-text';
            banner.appendChild(title);
            banner.appendChild(text);
            const list = document.getElementById('vtt-list');
            if (list) sidebar.insertBefore(banner, list);
            else sidebar.appendChild(banner);
        }
        (banner.querySelector('.vtt-empty-state-title') as HTMLElement).textContent = titleText;
        (banner.querySelector('.vtt-empty-state-text') as HTMLElement).textContent = bodyText;

        // Rebuild the action button(s) each call so stale labels/handlers don't
        // linger (e.g. the "Searching…" banner reuses this element with none).
        banner.querySelector('.vtt-empty-state-actions')?.remove();
        banner.querySelector('.vtt-empty-state-action')?.remove();
        const actions = action ? (Array.isArray(action) ? action : [action]) : [];
        if (actions.length) {
            const row = document.createElement('div');
            row.className = 'vtt-empty-state-actions';
            for (const a of actions) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = a.emergency
                    ? 'vtt-empty-state-action vtt-empty-state-action--emergency'
                    : 'vtt-empty-state-action';
                btn.textContent = a.label;
                // A disabled action still states its label (the cooldown
                // countdown) — inert, but never a button that silently no-ops.
                if (a.disabled) btn.disabled = true;
                else btn.addEventListener('click', a.onClick);
                row.appendChild(btn);
            }
            banner.appendChild(row);
        }
    }

    hideStatusBanner(): void {
        document.getElementById('vtt-status')?.remove();
    }

    // ── sidebar visibility / playback highlight ─────────────────────────────
    updateSidebarVisibility(): void {
        if (window !== window.top) return;
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return;
        const onVideoPage = this.getVideoId() !== null;
        if (onVideoPage) {
            sidebar.style.display = '';
            document.body.classList.add('vtt-sidebar-active');
        } else {
            sidebar.style.display = 'none';
            document.body.classList.remove('vtt-sidebar-active');
            this.clearNoSubtitlesTimer();
            this.hideStatusBanner();
        }
    }

    startVideoPolling(): void {
        setInterval(() => {
            document.querySelectorAll('video').forEach((video) => {
                if (!video.dataset.vttAttached) {
                    video.dataset.vttAttached = 'true';
                    video.addEventListener('timeupdate', () => {
                        if (this.isAdPlaying()) return;
                        this.ui.highlightSubtitle(video.currentTime);
                    });
                }
            });
        }, 1000);
    }

    setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.shiftKey && e.code === 'KeyS') {
                if (this.state.swapTracks()) this.ui.refresh();
            }
            if (e.shiftKey && e.code === 'KeyD') this.ui.toggleDualMode();
            if (e.shiftKey && e.code === 'KeyO') this.ui.toggleOverlay();
            if (e.shiftKey && e.code === 'KeyG') this.ui.toggleGuessMode();
        });
    }

    // ── subtitle-track bookkeeping ──────────────────────────────────────────
    // Look up (and consume) the display name a pending request was filed under.
    takePending(key: string): string | undefined {
        const name = this.pendingRequests.get(key);
        if (name !== undefined) this.pendingRequests.delete(key);
        // Every request answered: the backstop would find an empty map and
        // return, so drop the timer rather than let it wake up for nothing.
        if (this.pendingRequests.size === 0) this.clearPendingTrackTimer();
        return name;
    }

    // Add a parsed track to state and clear any pending/visible "no subtitles"
    // notice. Sites call this after parsing their format-specific response.
    addParsedTrack(name: string, subs: Subtitle[]): void {
        if (subs.length === 0) return;
        if (!this.state.isDuplicate(subs)) {
            this.state.addTrack(name, subs);
        }
        this.clearNoSubtitlesTimer();
        this.hideStatusBanner();
        this.noSubsRetries = 0;
        this.trackFailures.delete(name);

        const site = platformOf(location.hostname);
        // Reported once per video, but only after the tracks stop arriving.
        //
        // Sending it from the first track would freeze track_count at 1: the
        // second track typically lands ~100ms later (measured on Netflix), and
        // the one-shot has already fired by then. That understated every dual
        // load as a single-track one — the metric would have said the product
        // works half as often as it does.
        this.scheduleSubtitlesLoadedReport(site);
        // The funnel's real second step. subtitles_loaded also fires for a
        // single track, so it can't stand in for "the product actually worked".
        if (this.state.tracks.length >= 2) {
            this.analyticsOnce.fire('dual_subs_shown', () => {
                trackVia('dual_subs_shown', {
                    site,
                    learning: this.langPrefs?.learning ?? '',
                    native: this.langPrefs?.native ?? '',
                });
            });
        }

        // Only clear the cooldown once nothing is still failing. In the exact
        // case this feature exists for — one track lands, the other is
        // throttled — zeroing it here would show a live retry button while the
        // page-script breaker is still open, so the click would do nothing.
        if (this.trackFailures.size === 0) {
            // Recovery, not a first load: something failed earlier on this
            // video and now everything is present. Keyed off hadFailures rather
            // than the map emptying, because resetForNewVideo() clears the map
            // on every manual retry — the transition alone would fire on a
            // retry that never actually recovered anything.
            if (this.hadFailures) {
                const waitedS = Math.round((Date.now() - this.firstFailureAt) / 1000);
                const via = this.lastRecoveryTrigger;
                this.hadFailures = false;
                this.firstFailureAt = 0;
                trackVia('subs_recovered', { site, via, waited_s: waitedS });
            }
            this.cooldownUntil = 0;
            this.autoProbes = 0; // full recovery ends the throttle episode
        }
        // The other half may still be missing, so re-evaluate rather than
        // blindly clearing: the notice must survive a partial recovery.
        this.updatePartialFailureNotice();
        // Re-arm the auto-probe tick when a throttled half is still missing:
        // clearNoSubtitlesTimer() above just killed it, and without this the
        // probe would only fire when the failure landed AFTER the working
        // track (evaluateSubtitleOutcome arms the other ordering).
        if (this.cooldownRemainingMs() > 0 && this.autoProbes < AUTO_PROBE_LIMIT) {
            this.scheduleCooldownTick();
        }
        this.ui.refresh();
    }

    // ── track failure bookkeeping ───────────────────────────────────────────
    // Record why a track didn't load, then decide what (if anything) to show.
    noteTrackFailure(
        name: string,
        info: {
            failure?: VttFailure;
            retryAfterMs?: number;
            status?: number;
            attempts?: number;
            breakerStep?: number;
            /** True for machine-translation (tlang=) requests — what YouTube throttles. */
            translation?: boolean;
        },
    ): void {
        const now = Date.now();
        const failure = info.failure ?? 'unknown';
        this.trackFailures.set(name, {
            failure,
            status: info.status,
            attempts: info.attempts,
            breakerStep: info.breakerStep,
            at: now,
        });
        if (!this.hadFailures) {
            this.hadFailures = true;
            this.firstFailureAt = now;
        }
        if (info.retryAfterMs && info.retryAfterMs > 0) {
            this.cooldownUntil = Math.max(this.cooldownUntil, now + info.retryAfterMs);
        }
        if (failure === 'rate-limited') {
            // Once per video: this fires per failed track and the evaluation
            // loop runs repeatedly, so an unguarded send turns one throttling
            // episode into dozens of hits. breaker_step still shows the
            // escalation because it is read at the moment of the first report.
            this.analyticsOnce.fire('subs_rate_limited', () => {
                trackVia('subs_rate_limited', {
                    site: platformOf(location.hostname),
                    translation: info.translation === true,
                    attempts: info.attempts ?? 0,
                    retry_after_s: Math.round((info.retryAfterMs ?? 0) / 1000),
                    breaker_step: info.breakerStep ?? 0,
                });
            });
        }
        this.evaluateSubtitleOutcome();
    }

    /** ms left on the rate-limit cooldown, 0 when none is running. */
    cooldownRemainingMs(): number {
        return Math.max(0, this.cooldownUntil - Date.now());
    }

    /**
     * The human explanation for why a requested track is missing, or null when
     * nothing failed. One source of truth for every surface that has to answer
     * "why is half of this missing?" — the sidebar notice's tooltip and the
     * disabled Dual mode chip (AppInterface.missingTrackHint) both read it, so
     * the two never drift apart.
     *
     * Wording note: no promised time-to-recovery. YouTube's limit has been
     * observed to hold for hours, so "usually clears in a minute" was a lie
     * the user caught us in. Say what is known — it varies — and no more.
     */
    missingTrackHint(): string | null {
        if (this.trackFailures.size === 0) return null;
        const failed = this.dominantFailure();
        if (!failed) return null;
        if (this.isThrottled()) {
            return t(
                'ytPartialThrottledHint',
                'YouTube has temporarily limited automatic translation for you. ' +
                    "It's their limit, not a problem with the extension — it can clear in minutes, " +
                    'but sometimes lasts hours. The original subtitles keep working meanwhile.',
            );
        }
        if (failed === 'not-offered' || failed === 'unavailable') {
            return t(
                'ytPartialNotOfferedHint',
                'YouTube offers no automatic translation into this language for this video. ' +
                    'Retrying will not help — the original subtitles are still shown.',
            );
        }
        return t(
            'ytPartialFailedHint',
            'The subtitle link expired before the translation loaded. Searching again usually fixes it.',
        );
    }

    // One quiet line under the language chip when a track is missing but others
    // are playing. Deliberately NOT the #vtt-status banner: that is a
    // full-width block above the transcript, and pushing the subtitles down to
    // apologise for a missing translation costs more than it explains.
    updatePartialFailureNotice(): void {
        // Its own row AFTER the sub-header, never inside it: #vtt-subheader is
        // a single flex line (language chip | mode buttons) and a third child
        // squeezes both of them into an unreadable mess.
        const subheader = document.getElementById('vtt-subheader');
        document.getElementById('vtt-partial-notice')?.remove();
        if (!subheader?.parentElement) return;
        // Only meaningful while something IS playing; the empty case banners.
        if (this.state.tracks.length === 0) return;

        const failed = this.dominantFailure();
        if (!failed) return;

        const throttled = this.isThrottled();
        // "Not offered" is a normal outcome, not a fault — say it plainly once
        // and offer nothing to click, because there is nothing to retry.
        // No countdown: the wait has no reliable end (YouTube's limit can hold
        // for hours), so a ticking number promised precision we don't have and
        // drew the eye to a clock instead of the explanation. State the fact,
        // and let the user decide when to retry.
        let text: string;
        if (throttled) {
            text = t('ytPartialThrottled', 'Translation limited by YouTube');
        } else if (failed === 'not-offered' || failed === 'unavailable') {
            text = t('ytPartialNotOffered', 'No translation for this video');
        } else {
            text = t('ytPartialFailed', "Couldn't load the translation");
        }

        const el = document.createElement('div');
        el.id = 'vtt-partial-notice';
        el.className = 'vtt-partial-notice';
        // Only rate limiting gets the warning treatment: it's temporary and
        // clears by itself. "No translation exists" is a normal outcome and
        // stays quiet — colouring it too would make the signal meaningless.
        if (throttled) el.classList.add('is-warning');
        // The row is one truncated line, so the explanation lives in the
        // tooltip. data-tip, not title: the native one waits ~1s and never
        // appears on keyboard focus. Same mechanism as the mode-cluster chips.
        el.dataset.tip = this.missingTrackHint() ?? '';

        const label = document.createElement('span');
        label.textContent = text;
        el.appendChild(label);

        // Retry is always available when it could help — including during the
        // cooldown, when the breaker will refuse the network call. A premature
        // click is harmless BECAUSE the retry preserves loaded tracks (see
        // retrySubtitleSearch): it used to wipe the playing track first, so
        // clicking this during a cooldown swapped working subtitles for the
        // full "limiting requests" banner without a single request being sent.
        if (this.isRecoverableFailure()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vtt-partial-notice-retry';
            btn.textContent = '↻';
            btn.title = t('ytSearchAgain', 'Search again');
            btn.setAttribute('aria-label', t('ytSearchAgain', 'Search again'));
            btn.addEventListener('click', () => this.retrySubtitleSearch());
            el.appendChild(btn);
        }
        subheader.insertAdjacentElement('afterend', el);
    }

    /**
     * Could another attempt plausibly succeed? One definition for every
     * surface — the sidebar notice, the banner and the player menu each used
     * to spell this set out separately, and the menu's copy had already
     * drifted (it omitted no-pot and network). Mirrors isRetryable() in
     * timedtext-fetch.ts, which does the same job for the network layer.
     */
    isRecoverableFailure(): boolean {
        const f = this.dominantFailure();
        if (!f) return false;
        return this.isThrottled() || f === 'stale-url' || f === 'no-pot' || f === 'network';
    }

    // The most actionable failure across every requested track — what the UI
    // should talk about when the tracks disagree about why they're missing.
    dominantFailure(): VttFailure | undefined {
        // 'aborted' is deliberately absent: a request cancelled because the
        // user navigated away is not a failure to report, so it falls through
        // to undefined and renders nothing.
        const order: VttFailure[] = [
            'rate-limited',
            'cooldown',
            'stale-url',
            'no-pot',
            'network',
            // Below network: a reply that never came is less diagnostic than
            // one that came back with a reason, so a real error wins the label.
            'timeout',
            'not-offered',
            'unavailable',
            'unknown',
        ];
        const seen = new Set([...this.trackFailures.values()].map((i) => i.failure));
        return order.find((f) => seen.has(f));
    }

    /** The recorded detail behind dominantFailure(), for reports and events. */
    failureDetail(): TrackFailureInfo | undefined {
        const worst = this.dominantFailure();
        if (!worst) return undefined;
        return [...this.trackFailures.values()].find((i) => i.failure === worst);
    }

    /**
     * True when the failure is YouTube rate limiting (or its cooldown) —
     * temporary and self-clearing. Narrower than isRecoverableFailure(): a
     * stale URL is also worth retrying, but it isn't throttling and must not
     * borrow the throttling copy.
     */
    isThrottled(): boolean {
        // The cooldown alone is not enough to claim throttling: it deliberately
        // outlives resetForNewVideo() (so retry spam can't clear it), which
        // means a caption-less video opened during one would otherwise be
        // reported as "YouTube is limiting requests" when nothing was even
        // requested. A failure has to have actually been recorded.
        const f = this.dominantFailure();
        if (!f) return false;
        return f === 'rate-limited' || f === 'cooldown' || this.cooldownRemainingMs() > 0;
    }

    // Called after each failure. A partial failure (something did load) must
    // never raise the banner — the user is watching with the track that worked.
    // It gets a quiet one-line notice under the language chip instead, which is
    // visible without going looking for it (the player-menu row only shows once
    // that menu is opened, which turned out to be too well hidden).
    evaluateSubtitleOutcome(): void {
        if (this.state.tracks.length > 0) {
            this.updatePartialFailureNotice();
            // Something plays but something else didn't. The `failure` param is
            // the whole point: "YouTube throttled us" and "no translation
            // exists for this pair" look identical to the user and are fixed
            // in entirely different ways.
            if (this.trackFailures.size > 0) {
                this.analyticsOnce.fire('subs_partial', () => {
                    trackVia('subs_partial', {
                        site: platformOf(location.hostname),
                        failure: this.dominantFailure() ?? 'unknown',
                        missing: !this.state.hasNativeTrack()
                            ? 'native'
                            : !this.state.hasLearningTrack()
                              ? 'learning'
                              : 'other',
                        throttled: this.isThrottled(),
                        learning: this.langPrefs?.learning ?? '',
                        native: this.langPrefs?.native ?? '',
                    });
                });
            }
            // The banner path arms the cooldown tick for its countdown; the
            // partial notice shows none, so arm it here purely so the auto
            // probe can fire at expiry. Skip it once the budget is spent —
            // nothing would happen at zero, so the interval would just spin.
            if (this.cooldownRemainingMs() > 0 && this.autoProbes < AUTO_PROBE_LIMIT) {
                this.scheduleCooldownTick();
            }
            this.ui.refresh();
            return;
        }
        // Nothing loaded and nothing still in flight: we know why already, so
        // don't sit on "Searching…" for the rest of the grace period.
        if (this.pendingRequests.size === 0) this.declareNoSubtitles();
    }

    // NOTE: does NOT reset noSubsRetries — this runs both on a genuine video
    // change AND inside reprocessCurrentVideo() ("Search again"), and the retry
    // count must survive the latter so the reload fallback can appear. The count
    // is cleared on a real video change (resetNoSubsRetries) and when a track
    // finally loads (addParsedTrack).
    resetForNewVideo(opts: { preserveTracks?: boolean } = {}): void {
        this.pendingRequests.clear();
        // Nothing is outstanding any more, so the backstop has nothing to
        // report; leaving it armed would fire it against the next video's
        // requests on a grace period measured from the previous one.
        this.clearPendingTrackTimer();
        this.trackFailures.clear();
        document.getElementById('vtt-partial-notice')?.remove();
        // NOTE: cooldownUntil deliberately survives — see resetNoSubsRetries.
        // preserveTracks (every retry path): keep what's already playing — and
        // the user's guess progress with it — while the missing half is
        // re-asked for. Wiping here meant a retry refused by the breaker left
        // the panel emptier than before the click.
        if (!(opts.preserveTracks && this.state.tracks.length > 0)) {
            this.state.reset();
            // New video → re-disable native captions once (if the overlay is
            // on), even if the user had manually re-enabled them on the
            // previous video. Skipped when tracks survive: nothing about the
            // video changed, so the user's CC choice stands.
            this.ui.resetNativeSubsGuard();
        }
        this.ui.refresh();
        // Re-arm the empty-state check (clears any stale notice; a no-op
        // banner-wise while preserved tracks are showing).
        this.scheduleNoSubtitlesCheck();
    }

    // Clear the "Search again" retry count — call on a genuine video change so
    // the reload fallback starts fresh for the next video. The rate-limit
    // cooldown is cleared HERE and not in resetForNewVideo(), because that also
    // runs inside reprocessCurrentVideo() ("Search again") and the cooldown has
    // to outlive exactly the retry spam it exists to absorb.
    resetNoSubsRetries(): void {
        this.noSubsRetries = 0;
        // Only here, not in resetForNewVideo(): this runs on a genuine video
        // change, while that one also runs on every retry round.
        this.searchDeferred = false;
        this.cooldownUntil = 0;
        this.autoProbes = 0;
        // Analytics one-shots re-arm HERE, for the same reason the cooldown
        // clears here: this runs only on a genuine video change, while
        // resetForNewVideo() also runs on every "Search again" — re-arming
        // there would report the same video once per retry.
        this.analyticsOnce.reset();
        // Drop a pending subtitles_loaded with it: its captured count belongs to
        // the video we just left, and firing it here would attribute the old
        // load to the new one.
        this.clearSubsLoadedTimer();
        this.hadFailures = false;
        this.firstFailureAt = 0;
        this.lastNoSubsFailure = null;
        this.lastRecoveryTrigger = 'late_arrival';
    }

    updateHighlight(): void {
        if (this.isAdPlaying()) return;
        const video = document.querySelector('video');
        if (video) this.ui.highlightSubtitle(video.currentTime);
    }
}
