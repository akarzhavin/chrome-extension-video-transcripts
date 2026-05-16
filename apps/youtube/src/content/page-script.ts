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

(function () {
    const TAG = '[YT-VTT page-script]';
    const originalFetch = window.fetch.bind(window);
    const potByVideoId = new Map<string, string>();

    // ---------- pot sniffing ----------

    function tryCapturePot(url: string): void {
        try {
            const u = new URL(url, location.href);
            if (!u.pathname.includes('/api/timedtext')) return;
            const v = u.searchParams.get('v');
            const pot = u.searchParams.get('pot');
            if (v && pot && !potByVideoId.has(v)) {
                potByVideoId.set(v, pot);
                console.log(TAG, 'captured pot for', v);
            }
        } catch {
            // ignore
        }
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

    function postTracks(player: PlayerResponse): void {
        const rawTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const videoId = player.videoDetails?.videoId;
        if (!rawTracks || !videoId) return;
        const tracks = rawTracks.map((t) => ({
            baseUrl: t.baseUrl,
            lang: t.languageCode,
            name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
            kind: t.kind,
        }));
        console.log(TAG, 'sending tracks for', videoId, tracks.map((t) => t.lang));
        window.postMessage({ type: 'YT_CAPTIONS_FOUND', videoId, tracks }, '*');
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

    async function readPlayerResponseWithRetry(maxAttempts = 50): Promise<PlayerResponse | null> {
        for (let i = 0; i < maxAttempts; i++) {
            const pr = readPlayerResponseFromYtdApp();
            if (pr?.videoDetails?.videoId && pr.captions) return pr;
            await new Promise((r) => setTimeout(r, 100));
        }
        return readPlayerResponseFromYtdApp();
    }

    async function broadcastCurrent(): Promise<void> {
        const pr = await readPlayerResponseWithRetry();
        if (pr) postTracks(pr);
    }

    document.addEventListener('yt-navigate-finish', () => {
        setTimeout(broadcastCurrent, 200);
    });

    // ---------- CC toggle to force pot generation ----------

    function clickCcButton(): boolean {
        const btn = document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
        if (btn) {
            btn.click();
            return true;
        }
        return false;
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

    async function ensurePot(videoId: string): Promise<string | null> {
        if (potByVideoId.has(videoId)) return potByVideoId.get(videoId)!;

        // Wait briefly for the player UI to be ready
        for (let i = 0; i < 20; i++) {
            if (document.querySelector('.ytp-subtitles-button')) break;
            await new Promise((r) => setTimeout(r, 200));
        }

        console.log(TAG, 'pot not yet seen, toggling CC');
        toggleCc();

        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (potByVideoId.has(videoId)) {
                toggleCc(); // turn CC back off
                return potByVideoId.get(videoId)!;
            }
        }

        toggleCc();
        return null;
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
            console.warn(TAG, 'no pot for', videoId);
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
})();
