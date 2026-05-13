import { AppState } from './AppState';
import { SidebarUI } from './SidebarUI';
import { parseVTT } from '../common/parser';
import { LanguageUtils } from './LanguageUtils';
import { AppInterface } from '../common/types';

class VttApp implements AppInterface {
    state: AppState;
    ui: SidebarUI;
    isTopWindow: boolean;

    constructor() {
        this.isTopWindow = window === window.top;
        this.state = new AppState();
        this.ui = new SidebarUI(this.state, this);
        
        console.log("VTT Sidebar: Running in " + (this.isTopWindow ? "top window." : "iframe."));
        this.ui.init();
        this.setupListeners();
        this.startVideoPolling();
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
            if (e.shiftKey && e.code === 'KeyD') {
                if (this.state.toggleDualMode()) this.ui.refresh();
            }
            if (e.shiftKey && e.code === 'KeyO') {
                this.state.overlayEnabled = !this.state.overlayEnabled;
                this.ui.refresh();
            }
            if (e.shiftKey && e.code === 'KeyG') {
                if (this.state.toggleGuessMode()) this.ui.refresh();
            }
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
}

bootstrap();
