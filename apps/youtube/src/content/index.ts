import {
    AppState,
    SidebarUI,
    AppInterface,
    installAuthStatusBadge,
    installQuickAddOverlay,
} from '@video-transcripts/shared';
import { parseJson3 } from './json3';

interface CaptionTrack {
    baseUrl: string;
    lang: string;
    name: string;
    kind?: string;
}

interface TrackRequest {
    key: string;       // unique id for matching response
    name: string;
    baseUrl: string;
    tlang?: string;
}

class YouTubeVttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    detector: YouTubeCaptionDetector;
    pendingRequests: Map<string, string> = new Map();

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
        this.ui.refresh();
    }

    resetForNewVideo(): void {
        this.pendingRequests.clear();
        this.state.reset();
        this.ui.refresh();
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

        const requests = this.buildTrackRequests(tracks, videoId);
        requests.forEach((req) => this.app.requestVtt(req, videoId));
    }

    buildTrackRequests(tracks: CaptionTrack[], videoId: string): TrackRequest[] {
        const requests: TrackRequest[] = [];
        const isEnglish = (t: CaptionTrack) => t.lang === 'en' || t.lang.startsWith('en-');
        const isRussian = (t: CaptionTrack) => t.lang === 'ru' || t.lang.startsWith('ru-');

        const englishTrack = tracks.find(isEnglish);
        const russianTrack = tracks.find(isRussian);
        const mkKey = (name: string) => `${videoId}:${name}`;

        if (englishTrack) {
            requests.push({ key: mkKey('English'), name: 'English', baseUrl: englishTrack.baseUrl });
            if (russianTrack) {
                requests.push({ key: mkKey('Russian'), name: 'Russian', baseUrl: russianTrack.baseUrl });
            } else {
                requests.push({ key: mkKey('Russian'), name: 'Russian', baseUrl: englishTrack.baseUrl, tlang: 'ru' });
            }
        } else if (tracks.length > 0) {
            const primary = tracks[0];
            const primaryName = primary.name || primary.lang;
            requests.push({ key: mkKey(primaryName), name: primaryName, baseUrl: primary.baseUrl });
            if (russianTrack && russianTrack !== primary) {
                requests.push({ key: mkKey('Russian'), name: 'Russian', baseUrl: russianTrack.baseUrl });
            } else if (!isRussian(primary)) {
                requests.push({ key: mkKey('Russian'), name: 'Russian', baseUrl: primary.baseUrl, tlang: 'ru' });
            }
        }

        return requests;
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
