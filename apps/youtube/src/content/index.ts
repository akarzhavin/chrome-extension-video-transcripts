import {
    AppState,
    SidebarUI,
    AppInterface,
    installAuthStatusBadge,
    installQuickAddOverlay,
    loadLanguagePrefs,
    saveLanguagePrefs,
    onLanguagePrefsChanged,
    labelForLanguage,
    SUPPORTED_LANGUAGES,
    LanguagePrefs,
} from '@video-transcripts/shared';
import { parseJson3 } from './json3';
import { CaptionTrack, TrackRequest, planTrackRequests } from './trackPlan';

// Localized UI string from _locales/<lang>/messages.json. Falls back to the
// English default when the message isn't registered (non-extension contexts,
// or a key missing from a locale) so the sidebar never shows a blank label.
function t(key: string, fallback: string): string {
    try {
        return chrome.i18n?.getMessage(key) || fallback;
    } catch {
        return fallback;
    }
}

class YouTubeVttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    detector: YouTubeCaptionDetector;
    pendingRequests: Map<string, string> = new Map();
    langPrefs: LanguagePrefs | null = null;
    noSubsTimer: number | null = null;

    constructor() {
        this.state = new AppState();
        this.ui = new SidebarUI(this.state, this);
        this.detector = new YouTubeCaptionDetector(this);

        console.log('[YT-VTT] content script running');
        this.ui.init();
        this.updateSidebarVisibility();
        this.setupListeners();
        this.startVideoPolling();
        this.detector.start();
        void this.initLanguagePrefs();
    }

    async initLanguagePrefs(): Promise<void> {
        this.langPrefs = await loadLanguagePrefs();
        this.applyLangPrefsToState();
        this.updateOnboardingState();

        onLanguagePrefsChanged((prefs) => {
            this.langPrefs = prefs;
            this.applyLangPrefsToState();
            this.updateOnboardingState();
            // Apply newly-chosen languages to the video already on screen.
            if (prefs) this.detector.reprocessCurrentVideo();
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
        if (this.langPrefs) {
            this.hideLanguageOnboarding();
            this.scheduleNoSubtitlesCheck();
        } else {
            this.clearNoSubtitlesTimer();
            this.hideStatusBanner();
            this.showLanguageOnboarding();
        }
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
            opt.textContent = lang.native === lang.label ? lang.label : `${lang.label} — ${lang.native}`;
            select.appendChild(opt);
        }
        wrap.appendChild(select);
        return { wrap, select };
    }

    hideLanguageOnboarding(): void {
        document.getElementById('vtt-lang-onboarding')?.remove();
    }

    // While fetching for a video we show a "Searching…" status so the sidebar is
    // never blank. If nothing usable arrives within the grace period it flips to
    // "No subtitles". Cleared as soon as a track loads, the video changes, or
    // onboarding is showing.
    // graceMs: how long to keep "Searching…" before declaring "no subtitles".
    // Note: with CC off, fetching can need a pot token (~15s) — if it lands
    // after this window the notice flashes then clears once subs arrive.
    scheduleNoSubtitlesCheck(graceMs: number = 7000): void {
        this.clearNoSubtitlesTimer();
        this.hideStatusBanner();
        if (!this.langPrefs) return;
        if (this.detector.getVideoIdFromUrl() === null) return;
        if (this.state.tracks.length > 0) return; // already have something to show

        this.showStatusBanner(
            t('ytSearchingTitle', 'Searching for subtitles…'),
            t('ytSearchingText', 'Looking for captions for this video.'),
        );

        this.noSubsTimer = window.setTimeout(() => {
            this.noSubsTimer = null;
            if (!this.langPrefs) return;
            if (this.detector.getVideoIdFromUrl() === null) return;
            if (this.state.tracks.length === 0) this.declareNoSubtitles();
        }, graceMs);
    }

    // Show the "no subtitles" notice now (used both by the grace-period timeout
    // and when the page-script reports a video has no caption tracks at all).
    declareNoSubtitles(): void {
        this.clearNoSubtitlesTimer();
        if (!this.langPrefs) return;
        if (this.detector.getVideoIdFromUrl() === null) return;
        if (this.state.tracks.length > 0) return;
        this.showStatusBanner(
            t('ytNoSubsTitle', 'No subtitles available'),
            t(
                'ytNoSubsText',
                "This video doesn't have subtitles. Try another video — not every " +
                    'video on YouTube has captions.',
            ),
            {
                label: '↻ ' + t('ytSearchAgain', 'Search again'),
                onClick: () => this.detector.reprocessCurrentVideo(),
            },
        );
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
        action?: { label: string; onClick: () => void },
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

        // Rebuild the action button each call so stale labels/handlers don't linger
        // (e.g. the "Searching…" banner reuses this element without an action).
        banner.querySelector('.vtt-empty-state-action')?.remove();
        if (action) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vtt-empty-state-action';
            btn.textContent = action.label;
            btn.addEventListener('click', action.onClick);
            banner.appendChild(btn);
        }
    }

    hideStatusBanner(): void {
        document.getElementById('vtt-status')?.remove();
    }

    updateSidebarVisibility(): void {
        if (window !== window.top) return;
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return;
        const onVideoPage = this.detector.getVideoIdFromUrl() !== null;
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

    isAdPlaying(): boolean {
        const player = document.querySelector('#movie_player, .html5-video-player');
        return !!player && player.classList.contains('ad-showing');
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

    setupListeners(): void {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'YT_VTT_RESULT') {
                this.handleVttLoaded(event.data.url, event.data.text || '');
            }
        });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.shiftKey && e.code === 'KeyS') {
                if (this.state.swapTracks()) this.ui.refresh();
            }
            if (e.shiftKey && e.code === 'KeyD') this.ui.toggleDualMode();
            if (e.shiftKey && e.code === 'KeyO') this.ui.toggleOverlay();
            if (e.shiftKey && e.code === 'KeyG') this.ui.toggleGuessMode();
        });
    }

    requestVtt(req: TrackRequest, videoId: string): void {
        this.pendingRequests.set(req.key, req.name);
        console.log('[YT-VTT] FETCH_VTT ->', req.name);
        window.postMessage(
            { type: 'YT_FETCH_VTT', url: req.key, baseUrl: req.baseUrl, videoId, tlang: req.tlang },
            '*',
        );
    }

    handleVttLoaded(url: string, vttText: string): void {
        const name = this.pendingRequests.get(url);
        console.log('[YT-VTT] VTT_LOADED <-', name, 'bytes:', vttText?.length ?? 0);
        if (!name) return;
        this.pendingRequests.delete(url);

        const subs = parseJson3(vttText);
        console.log('[YT-VTT] parsed subs:', subs.length, 'for', name);
        if (subs.length === 0) return;

        if (!this.state.isDuplicate(subs)) {
            this.state.addTrack(name, subs);
        }
        // Got something to show — drop any pending/visible "no subtitles" notice.
        this.clearNoSubtitlesTimer();
        this.hideStatusBanner();
        this.ui.refresh();
    }

    resetForNewVideo(): void {
        this.pendingRequests.clear();
        this.state.reset();
        this.ui.refresh();
        // New video → re-arm the empty-state check (clears any stale notice).
        this.scheduleNoSubtitlesCheck();
    }

    seekVideo(time: number): void {
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = time;
            video.play().catch(() => {});
        }
    }

    updateHighlight(): void {
        if (this.isAdPlaying()) return;
        const video = document.querySelector('video');
        if (video) this.ui.highlightSubtitle(video.currentTime);
    }

    getOverlayParent(): HTMLElement | null {
        return document.querySelector('#movie_player') as HTMLElement | null
            ?? document.querySelector('video')?.parentElement
            ?? null;
    }
}

class YouTubeCaptionDetector {
    app: YouTubeVttApp;
    currentVideoId: string | null = null;
    captionsLoadedForVideo: string | null = null;

    constructor(app: YouTubeVttApp) {
        this.app = app;
    }

    start(): void {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'YT_CAPTIONS_FOUND') {
                this.handleCaptionTracks(event.data.videoId, event.data.tracks);
            }
            if (event.data?.type === 'YT_NO_CAPTIONS') {
                this.handleNoCaptions(event.data.videoId);
            }
        });

        document.addEventListener('yt-navigate-finish', () => {
            this.checkCurrentVideo();
            this.app.updateSidebarVisibility();
        });

        let lastVideoId = this.getVideoIdFromUrl();
        setInterval(() => {
            const id = this.getVideoIdFromUrl();
            if (id !== lastVideoId) {
                lastVideoId = id;
                this.checkCurrentVideo();
                this.app.updateSidebarVisibility();
            }
        }, 1000);

        // Ask page-script for current video's tracks (it may already have them)
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    getVideoIdFromUrl(): string | null {
        try {
            const url = new URL(location.href);
            if (url.pathname === '/watch') return url.searchParams.get('v');
            if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
        } catch {
            // ignore
        }
        return null;
    }

    checkCurrentVideo(): void {
        const id = this.getVideoIdFromUrl();
        if (!id || id === this.currentVideoId) return;
        this.currentVideoId = id;
        this.captionsLoadedForVideo = null;
        this.app.resetForNewVideo();
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    handleCaptionTracks(videoId: string, tracks: CaptionTrack[]): void {
        if (!videoId || !tracks || tracks.length === 0) return;

        const currentId = this.getVideoIdFromUrl();
        if (currentId && videoId !== currentId) return;

        if (videoId !== this.currentVideoId) {
            this.currentVideoId = videoId;
            this.captionsLoadedForVideo = null;
            this.app.resetForNewVideo();
        }

        if (this.captionsLoadedForVideo === videoId) return;
        this.captionsLoadedForVideo = videoId;

        console.log('[YT-VTT] caption tracks for', videoId, tracks.map((t) => t.lang));

        // First-run gate: don't load anything until the user picks a language
        // pair. The banner tells them to open the popup; storage.onChanged then
        // re-processes this video automatically.
        if (!this.app.langPrefs) {
            this.app.showLanguageOnboarding();
            return;
        }

        const requests = this.buildTrackRequests(tracks, videoId);
        requests.forEach((req) => this.app.requestVtt(req, videoId));
    }

    handleNoCaptions(videoId: string): void {
        const currentId = this.getVideoIdFromUrl();
        if (currentId && videoId !== currentId) return;
        // The page-script confirmed this video has no caption tracks at all —
        // skip the "searching" wait and say so right away.
        this.app.declareNoSubtitles();
    }

    reprocessCurrentVideo(): void {
        this.captionsLoadedForVideo = null;
        this.app.resetForNewVideo();
        window.postMessage({ type: 'YT_QUERY_CAPTIONS' }, '*');
    }

    buildTrackRequests(tracks: CaptionTrack[], videoId: string): TrackRequest[] {
        const prefs = this.app.langPrefs;
        if (!prefs) return [];

        const plan = planTrackRequests(prefs, tracks, videoId);
        if (!plan) return [];

        // Keep AppState's primary/secondary selection aligned with the names the
        // plan assigned (VTTs arrive asynchronously and out of order).
        this.app.state.setLanguagePreferences(plan.primaryLabel, plan.secondaryLabel);

        return plan.requests;
    }
}

function injectLayoutOverrides(): void {
    const style = document.createElement('style');
    style.id = 'yt-vtt-layout';
    style.textContent = `
        body.vtt-sidebar-active:has(#vtt-sidebar:not(.collapsed):not(.fullscreen)) ytd-app {
            width: calc(100vw - 320px) !important;
            min-width: 0 !important;
        }
        body.vtt-sidebar-active:has(#vtt-sidebar:not(.collapsed):not(.fullscreen)) #masthead-container.ytd-app {
            width: calc(100vw - 320px) !important;
        }
        body.vtt-sidebar-active ytd-app {
            transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
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
        #vtt-status .vtt-empty-state-action {
            margin-top: 12px;
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
    `;
    (document.head || document.documentElement).appendChild(style);
}

function watchSidebarState(): void {
    // YouTube's layout uses window.innerWidth via JS, so we must fire a resize event
    // whenever the effective content width changes (sidebar toggled / fullscreen entered).
    const fire = () => window.dispatchEvent(new Event('resize'));

    const startObservingSidebar = () => {
        const sidebar = document.getElementById('vtt-sidebar');
        if (!sidebar) return false;
        new MutationObserver(fire).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        return true;
    };

    if (!startObservingSidebar()) {
        const t = setInterval(() => {
            if (startObservingSidebar()) clearInterval(t);
        }, 200);
    }

    new MutationObserver(fire).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('fullscreenchange', fire);

    // Initial nudge so YouTube reflows on first sidebar appearance
    setTimeout(fire, 500);
}

function bootstrap(): void {
    if (!window.location.hostname.includes('youtube.com')) return;
    injectLayoutOverrides();
    new YouTubeVttApp();
    watchSidebarState();
    installQuickAddOverlay();
    if (window === window.top) installAuthStatusBadge();
}

bootstrap();
