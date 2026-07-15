import { installNetflixHook } from './netflix/manifest-hook';

interface RawCaptionTrack {
    baseUrl: string;
    languageCode: string;
    name?: { simpleText?: string; runs?: Array<{ text: string }> };
    kind?: string;
}

interface PlayerResponse {
    captions?: {
        playerCaptionsTracklistRenderer?: {
            captionTracks?: RawCaptionTrack[];
        };
    };
    videoDetails?: { videoId?: string };
}

// This MAIN-world script is injected on both youtube.com and netflix.com. The
// two sites capture subtitles in completely different ways, so branch up front:
// Netflix hooks JSON.parse/stringify (see netflix/manifest-hook.ts); YouTube
// sniffs the timedtext network calls below.
if (location.hostname.includes('netflix.com')) {
    installNetflixHook();
} else {
    installYouTubeHook();
}

function installYouTubeHook() {
    const TAG = '[YT-VTT page-script]';
    const originalFetch = window.fetch.bind(window);
    const potByVideoId = new Map<string, string>();
    const potWaitersByVideoId = new Map<string, Set<(pot: string) => void>>();

    // ---------- pot sniffing ----------

    function tryCapturePot(url: string): void {
        try {
            const u = new URL(url, location.href);
            if (!u.pathname.includes('/api/timedtext')) return;
            const v = u.searchParams.get('v');
            const pot = u.searchParams.get('pot');
            if (!v || !pot) return;
            if (!potByVideoId.has(v)) {
                potByVideoId.set(v, pot);
                console.log(TAG, 'captured pot for', v);
            }
            const waiters = potWaitersByVideoId.get(v);
            if (waiters && waiters.size > 0) {
                const fns = [...waiters];
                potWaitersByVideoId.delete(v);
                fns.forEach((fn) => fn(pot));
            }
        } catch {
            // ignore
        }
    }

    function waitForPot(videoId: string, timeoutMs: number): Promise<string | null> {
        return new Promise((resolve) => {
            let done = false;
            const waiter = (pot: string) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(pot);
            };
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                const set = potWaitersByVideoId.get(videoId);
                if (set) {
                    set.delete(waiter);
                    if (set.size === 0) potWaitersByVideoId.delete(videoId);
                }
                resolve(null);
            }, timeoutMs);
            const set = potWaitersByVideoId.get(videoId) ?? new Set();
            set.add(waiter);
            potWaitersByVideoId.set(videoId, set);
        });
    }

    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
        try {
            const urlStr = typeof url === 'string' ? url : url.href;
            if (urlStr.includes('/api/timedtext')) tryCapturePot(urlStr);
        } catch {
            // ignore
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return xhrOpen.apply(this, [method, url, ...rest] as any);
    };

    window.fetch = async function (...args: Parameters<typeof fetch>) {
        try {
            const input = args[0];
            const url =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url;
            if (url && url.includes('/api/timedtext')) tryCapturePot(url);
        } catch {
            // ignore
        }
        return originalFetch.apply(window, args);
    };

    // ---------- player response reading ----------

    function postTracks(player: PlayerResponse): boolean {
        const rawTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const videoId = player.videoDetails?.videoId;
        if (!videoId || !rawTracks || rawTracks.length === 0) return false;
        const tracks = rawTracks.map((t) => ({
            baseUrl: t.baseUrl,
            lang: t.languageCode,
            name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
            kind: t.kind,
        }));
        console.log(TAG, 'sending tracks for', videoId, tracks.map((t) => t.lang));
        window.postMessage({ type: 'YT_CAPTIONS_FOUND', videoId, tracks }, '*');
        return true;
    }

    function readPlayerResponseFromYtdApp(): PlayerResponse | null {
        try {
            const app = document.getElementsByTagName('ytd-app')[0] as HTMLElement & {
                data?: { playerResponse?: PlayerResponse };
            };
            return app?.data?.playerResponse ?? null;
        } catch {
            return null;
        }
    }

    function currentUrlVideoId(): string | null {
        try {
            const p = location.pathname;
            if (p === '/watch') return new URLSearchParams(location.search).get('v');
            if (p.startsWith('/shorts/')) return p.split('/')[2] || null;
        } catch {
            // ignore
        }
        return null;
    }

    // Resolve captions for whatever video the URL currently points at. Posts
    // tracks the moment they appear (videoId + captions ship together). Only
    // declares "no captions" once the player response has caught up to THIS
    // video (matching id) and stayed caption-less briefly — so scrolling
    // between Shorts, where the response lags the URL, never misfires.
    async function broadcastCurrent(): Promise<void> {
        const target = currentUrlVideoId();
        let caughtUpNoCap = 0;
        for (let i = 0; i < 70; i++) {
            // Bail if the user moved to a different video meanwhile.
            if (target && currentUrlVideoId() !== target) return;

            const pr = readPlayerResponseFromYtdApp();
            const vid = pr?.videoDetails?.videoId;
            const matches = !!vid && (!target || vid === target);

            if (matches) {
                if (postTracks(pr!)) return;
                // Response is for this video but lists no captions. Captions ship
                // with the response, so a brief stable confirmation is enough.
                if (++caughtUpNoCap >= 8) {
                    console.log(TAG, 'no caption tracks for', vid);
                    window.postMessage({ type: 'YT_NO_CAPTIONS', videoId: vid }, '*');
                    return;
                }
            } else {
                caughtUpNoCap = 0; // player response hasn't caught up to this video yet
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    document.addEventListener('yt-navigate-finish', () => {
        setTimeout(broadcastCurrent, 200);
    });

    // ---------- CC toggle to force pot generation ----------

    // Finds the captions toggle to click for pot minting. Surfaces differ:
    //  - Shorts uses `.ytmClosedCaptioningButtonButton`; its standard
    //    `.ytp-subtitles-button` reports "unavailable" and does nothing.
    //  - The watch player uses `.ytp-subtitles-button`.
    // Buttons may be present-but-hidden (e.g. inside the Shorts "More actions"
    // menu) — HTMLElement.click() still toggles them, so visibility is fine.
    function isUnavailable(el: Element): boolean {
        return /unavailable|недоступн|недосту?пні/i.test(el.getAttribute('aria-label') || '');
    }

    function findCcButton(): HTMLElement | null {
        const shorts = document.querySelector('.ytmClosedCaptioningButtonButton') as HTMLElement | null;
        if (shorts && !isUnavailable(shorts)) return shorts;

        const std = document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
        if (std && !isUnavailable(std)) return std;

        // Generic fallback by aria-label (covers localized labels), skipping any
        // control that explicitly reports captions as unavailable.
        const buttons = document.querySelectorAll('button[aria-label], [role="button"][aria-label]');
        for (const el of Array.from(buttons)) {
            if (isUnavailable(el)) continue;
            if (/subtitle|caption|субтитр|субтитри/i.test(el.getAttribute('aria-label') || '')) {
                return el as HTMLElement;
            }
        }
        return null;
    }

    function clickCcButton(): boolean {
        const btn = findCcButton();
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    }

    // Turn YouTube's own captions OFF once, only if they're currently on. Used
    // to keep native captions from stacking behind our dual-subtitle overlay.
    // One-shot per request: it never turns captions back on, so a user who
    // re-enables CC afterwards keeps them. The CC button reports its state via
    // aria-pressed; if that's absent we leave captions untouched (clicking blind
    // could turn them ON). Retries briefly because the player chrome can be late.
    function turnCcOffIfOn(attempt = 0): void {
        const btn = findCcButton();
        if (btn) {
            if (btn.getAttribute('aria-pressed') === 'true') {
                btn.click();
                console.log(TAG, 'native captions -> Off');
            }
            return;
        }
        if (attempt < 10) setTimeout(() => turnCcOffIfOn(attempt + 1), 300);
    }

    function fireCcKey(): void {
        const video = document.querySelector('video');
        if (!video) return;
        const init: KeyboardEventInit = {
            key: 'c',
            code: 'KeyC',
            keyCode: 67,
            which: 67,
            bubbles: true,
            cancelable: true,
        } as KeyboardEventInit;
        video.dispatchEvent(new KeyboardEvent('keydown', init));
        video.dispatchEvent(new KeyboardEvent('keyup', init));
    }

    function toggleCc(): void {
        // Click button if available, otherwise fall back to keyboard event
        if (!clickCcButton()) fireCcKey();
    }

    const inFlightEnsurePot = new Map<string, Promise<string | null>>();

    async function generatePotForVideo(videoId: string): Promise<string | null> {
        // Wait briefly for a captions toggle to exist (watch player or Shorts).
        for (let i = 0; i < 20; i++) {
            if (findCcButton()) break;
            await new Promise((r) => setTimeout(r, 200));
        }

        console.log(TAG, 'pot not yet seen, toggling CC for', videoId);
        const wait = waitForPot(videoId, 15000);
        toggleCc();
        const pot = await wait;
        toggleCc(); // restore previous CC state
        return pot;
    }

    async function ensurePot(videoId: string): Promise<string | null> {
        const own = potByVideoId.get(videoId);
        if (own) return own;
        const existing = inFlightEnsurePot.get(videoId);
        if (existing) return existing;
        const p = generatePotForVideo(videoId).finally(() => {
            inFlightEnsurePot.delete(videoId);
        });
        inFlightEnsurePot.set(videoId, p);
        return p;
    }

    // ---------- fetch with pot ----------

    function buildUrl(baseUrl: string, pot: string, tlang?: string): string {
        const u = new URL(baseUrl, location.href);
        u.searchParams.set('fmt', 'json3');
        u.searchParams.set('c', 'WEB');
        u.searchParams.set('pot', pot);
        if (tlang) u.searchParams.set('tlang', tlang);
        return u.toString();
    }

    function isUsableResponse(text: string): boolean {
        if (!text || text.length < 20) return false;
        // json3 with no events == empty translation slot etc.
        if (!text.includes('"events"')) return false;
        return true;
    }

    async function fetchOnce(url: string): Promise<string> {
        const res = await originalFetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
    }

    async function fetchVtt(reqKey: string, baseUrl: string, videoId: string, tlang?: string): Promise<void> {
        const pot = await ensurePot(videoId);
        if (!pot) {
            // console.warn(TAG, 'no pot for', videoId);
            window.postMessage({ type: 'YT_VTT_RESULT', url: reqKey, text: '', error: 'no_pot' }, '*');
            return;
        }
        const url = buildUrl(baseUrl, pot, tlang);
        let text = '';
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
            try {
                text = await fetchOnce(url);
                if (isUsableResponse(text)) {
                    console.log(TAG, 'fetched', text.length, 'bytes for', reqKey, attempt > 1 ? `(attempt ${attempt})` : '');
                    window.postMessage({ type: 'YT_VTT_RESULT', url: reqKey, text }, '*');
                    return;
                }
                console.warn(TAG, 'empty/invalid response for', reqKey, 'attempt', attempt, 'bytes:', text.length);
            } catch (e) {
                lastErr = e;
                console.warn(TAG, 'fetch attempt', attempt, 'failed for', reqKey, e);
            }
            await new Promise((r) => setTimeout(r, 400 * attempt));
        }
        console.warn(TAG, 'giving up on', reqKey, 'after retries');
        window.postMessage(
            { type: 'YT_VTT_RESULT', url: reqKey, text, error: lastErr ? String(lastErr) : 'empty_after_retries' },
            '*',
        );
    }

    // ---------- message bus ----------

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data) return;
        if (data.type === 'YT_QUERY_CAPTIONS') {
            broadcastCurrent();
            return;
        }
        if (data.type === 'YT_SET_NATIVE_SUBS' && data.enabled === false) {
            // Only the "turn off" direction — never force captions back on.
            turnCcOffIfOn();
            return;
        }
        if (
            data.type === 'YT_FETCH_VTT' &&
            typeof data.url === 'string' &&
            typeof data.baseUrl === 'string' &&
            typeof data.videoId === 'string'
        ) {
            fetchVtt(data.url, data.baseUrl, data.videoId, data.tlang);
        }
    });

    console.log(TAG, 'installed');
}
