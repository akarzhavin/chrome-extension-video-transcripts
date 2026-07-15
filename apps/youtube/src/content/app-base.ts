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
    SUPPORTED_LANGUAGES,
    LanguagePrefs,
    Subtitle,
} from '@video-transcripts/shared';

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
    /* Flex child of the sub-header row: shrinks (names ellipsize) rather than
       pushing the quick-mode icons out. It's a button (swaps the pair), so
       block the text selection the sidebar forces on for transcript quick-add. */
    #vtt-langpair {
        display: flex;
        min-width: 0;
        margin: 6px 0 10px;
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
    // How many times the user has hit "Search again" for the current no-subs
    // banner without any track showing up. Once they've retried and it's still
    // empty, we offer a page reload as the next fallback. Reset when a track
    // finally loads or the video changes.
    noSubsRetries: number = 0;

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
    abstract reprocessCurrentVideo(): void;
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

    // A "🇪🇸 Español → 🇬🇧 English" chip under the header reflecting the chosen
    // pair, so it's always clear which two languages are in play.
    updateLanguagePairChip(): void {
        // Mount ONLY into our own sub-header slot. No header-top fallback: the
        // ids are shared across extension versions, so a fallback would graft
        // the chip into a sidebar built by another installed copy.
        const subheader = document.getElementById('vtt-subheader');
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
        if (!existing && subheader) subheader.prepend(chip);
    }

    showLanguageOnboarding(): void {
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar || document.getElementById('vtt-lang-onboarding')) return;

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
            void saveLanguagePrefs({ learning: l, native: n });
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
            if (this.state.tracks.length === 0) this.declareNoSubtitles();
        }, graceMs);
    }

    // Show the "no subtitles" notice now (used both by the grace-period timeout
    // and when the site reports a video has no caption tracks at all).
    declareNoSubtitles(): void {
        this.clearNoSubtitlesTimer();
        if (!this.langPrefs) return;
        if (this.getVideoId() === null) return;
        if (this.state.tracks.length > 0) return;
        // First time we come up empty: offer "Search again" (the normal recovery
        // path). If the user already retried and subtitles still didn't load,
        // additionally surface a quiet, red "Reload page" emergency button — a
        // last-resort escape hatch, deliberately NOT styled as a feature.
        const actions: Array<{ label: string; onClick: () => void; emergency?: boolean }> = [
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

    // "Search again" handler: remember that the user retried (so the next empty
    // result can escalate to a reload prompt) and re-run site detection.
    retrySubtitleSearch(): void {
        this.noSubsRetries++;
        this.reprocessCurrentVideo();
    }

    // Emergency "Reload page" handler. The banner copy qualifies the click
    // ("this video HAS subtitles but we aren't showing them"), so it doubles as
    // a bug report: fire a best-effort diagnostic to the background worker, then
    // reload no matter what. The 400ms race caps how long a slow/dead worker can
    // delay the reload the user actually asked for.
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
                        })
                        .catch(() => undefined),
                    new Promise((resolve) => setTimeout(resolve, 400)),
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
    }

    showStatusBanner(
        titleText: string,
        bodyText: string,
        action?:
            | { label: string; onClick: () => void; emergency?: boolean }
            | Array<{ label: string; onClick: () => void; emergency?: boolean }>,
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
                btn.addEventListener('click', a.onClick);
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
        this.ui.refresh();
    }

    // NOTE: does NOT reset noSubsRetries — this runs both on a genuine video
    // change AND inside reprocessCurrentVideo() ("Search again"), and the retry
    // count must survive the latter so the reload fallback can appear. The count
    // is cleared on a real video change (resetNoSubsRetries) and when a track
    // finally loads (addParsedTrack).
    resetForNewVideo(): void {
        this.pendingRequests.clear();
        this.state.reset();
        // New video → re-disable native captions once (if the overlay is on),
        // even if the user had manually re-enabled them on the previous video.
        this.ui.resetNativeSubsGuard();
        this.ui.refresh();
        // New video → re-arm the empty-state check (clears any stale notice).
        this.scheduleNoSubtitlesCheck();
    }

    // Clear the "Search again" retry count — call on a genuine video change so
    // the reload fallback starts fresh for the next video.
    resetNoSubsRetries(): void {
        this.noSubsRetries = 0;
    }

    updateHighlight(): void {
        if (this.isAdPlaying()) return;
        const video = document.querySelector('video');
        if (video) this.ui.highlightSubtitle(video.currentTime);
    }
}
