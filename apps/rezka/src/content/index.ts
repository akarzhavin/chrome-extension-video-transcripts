import {
    AppState,
    SidebarUI,
    parseVTT,
    LanguageUtils,
    AppInterface,
    installAuthStatusBadge,
    installQuickAddOverlay,
} from '@video-transcripts/shared';

class VttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    isTopWindow: boolean;

    detector: VttDetector;

    constructor() {
        this.isTopWindow = window === window.top;
        this.state = new AppState();
        this.ui = new SidebarUI(this.state, this);
        this.detector = new VttDetector(this);
        
        console.log("VTT Sidebar: Running in " + (this.isTopWindow ? "top window." : "iframe."));
        this.ui.init();
        this.setupListeners();
        this.startVideoPolling();
        this.detector.start();
    }

    startVideoPolling(): void {
        setInterval(() => {
            document.querySelectorAll('video').forEach(video => {
                if (!video.dataset.vttAttached) {
                    video.dataset.vttAttached = "true";
                    console.log("VTT Sidebar: Attached timeupdate to a video element.");
                    
                    video.addEventListener('timeupdate', () => {
                        try {
                            chrome.runtime.sendMessage({ action: "TIME_UPDATE", time: video.currentTime });
                        } catch (e: any) {
                            if (!e.message.includes("Extension context invalidated")) console.error(e);
                        }
                    });
                }
            });
        }, 1000);
    }

    setupListeners(): void {
        chrome.runtime.onMessage.addListener((request) => {
            if (request.action === "VTT_LOADED") {
                this.handleNewSubtitles(request.payload);
            } else if (request.action === "TIME_UPDATE") {
                this.ui.highlightSubtitle(request.time);
            } else if (request.action === "SEEK_VIDEO") {
                this.seekVideoLocal(request.time);
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

    handleNewSubtitles(vttText: string): void {
        const newSubs = parseVTT(vttText);
        if (newSubs.length === 0) return;

        if (!this.state.isDuplicate(newSubs)) {
            const name = LanguageUtils.generateTrackName(newSubs, this.state.tracks);
            this.state.addTrack(name, newSubs);
        }
        this.ui.refresh();
    }

    seekVideo(time: number): void {
        try {
            chrome.runtime.sendMessage({ action: "SEEK_VIDEO", time });
        } catch (e: any) {
            if (!e.message.includes("Extension context invalidated")) console.error(e);
        }
        this.seekVideoLocal(time);
    }

    seekVideoLocal(time: number): void {
        document.querySelectorAll('video').forEach(video => {
            video.currentTime = time;
            video.play().catch(() => {});
        });
    }

    updateHighlight(): void {
        const video = document.querySelector('video');
        if (video) this.ui.highlightSubtitle(video.currentTime);
    }
}

class VttDetector {
    app: VttApp;
    processedUrls: Set<string> = new Set();

    constructor(app: VttApp) {
        this.app = app;
    }

    start(): void {
        this.observeDOM();
        this.pollVideoTracks();
        this.interceptNetwork();
    }

    observeDOM(): void {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node instanceof HTMLTrackElement) {
                        this.handleTrackElement(node);
                    } else if (node instanceof HTMLElement) {
                        node.querySelectorAll('track').forEach(track => this.handleTrackElement(track));
                    }
                });
            });
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    pollVideoTracks(): void {
        setInterval(() => {
            document.querySelectorAll('video').forEach(video => {
                for (let i = 0; i < video.textTracks.length; i++) {
                    const track = video.textTracks[i];
                    // We can't always get the URL from textTrack, but we can sometimes find the <track> element
                }
            });
        }, 2000);
    }

    handleTrackElement(track: HTMLTrackElement): void {
        const url = track.src;
        if (url && url.includes('.vtt') && !this.processedUrls.has(url)) {
            console.log("VTT Detector: Found track element:", url);
            this.loadVtt(url);
        }
    }

    async loadVtt(url: string): Promise<void> {
        if (this.processedUrls.has(url)) return;
        this.processedUrls.add(url);

        console.log("VttDetector: Requesting VTT fetch via background:", url);
        
        try {
            // We send the request to the background because it has host_permissions for voidboost
            // and is not subject to the CORS restrictions that affect the content script.
            chrome.runtime.sendMessage({ 
                action: "FETCH_VTT", 
                url: url 
            });
        } catch (err) {
            console.error("VttDetector: Failed to send FETCH_VTT message:", err);
            this.processedUrls.delete(url); // Allow retry
        }
    }

    interceptNetwork(): void {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('src/content/network-interceptor.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();

        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'VTT_URL_DETECTED') {
                this.loadVtt(event.data.url);
            }
        });
    }
}

function bootstrap(): void {
    let isRezka = false;
    const isTopWindow = window === window.top;
    
    if (isTopWindow) {
        if (window.location.hostname.includes('rezka.ag') || window.location.hostname.includes('hdrezka')) {
            isRezka = true;
        }
    } else {
        if (window.location.ancestorOrigins) {
            for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
                if (window.location.ancestorOrigins[i].includes('rezka.ag') || window.location.ancestorOrigins[i].includes('hdrezka')) {
                    isRezka = true;
                    break;
                }
            }
        }
    }

    if (!isRezka) return;
    new VttApp();
    installQuickAddOverlay();
    if (window === window.top) installAuthStatusBadge();
}

bootstrap();
