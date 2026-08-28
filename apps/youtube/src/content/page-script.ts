import { installNetflixHook } from './netflix/manifest-hook';
import { isNetflix } from './site';
import {
    fetchTimedText,
    RateLimitBreaker,
    type VttOutcome,
    type YtVttResultMessage,
} from './timedtext-fetch';

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
if (isNetflix()) {
    installNetflixHook();
} else {
    installYouTubeHook();
}

function installYouTubeHook() {
    const TAG = '[YT-VTT page-script]';
    const originalFetch = window.fetch.bind(window);

    // ---------- dev: force a timedtext status ----------
    // `#lingogram_http=429:5@2` → status 429, Retry-After 5s, for the first 2
    // requests. Real throttling can't be summoned on demand, and this is the
    // only way to exercise the 429/403/404 paths by hand. Stripped from prod by
    // the minifier via the __EXT_ENV__ guard (see docs/dev-flags.md).
    function makeForcedFetch(): typeof originalFetch | null {
        if (__EXT_ENV__ !== 'dev') return null;
        const m = /[?#&]lingogram_http=(\d{3})(?::(\d+))?(?:@(\d+))?/.exec(location.href);
        if (!m) return null;
        const status = Number(m[1]);
        const retryAfter = m[2];
        let remaining = m[3] ? Number(m[3]) : Infinity;
        console.warn(TAG, `dev: forcing HTTP ${status} on timedtext`,
            retryAfter ? `(Retry-After: ${retryAfter})` : '', Number.isFinite(remaining) ? `for ${remaining} requests` : '');
        return async (url: string | URL | Request, init?: RequestInit) => {
            if (remaining <= 0) return originalFetch(url as RequestInfo, init);
            remaining--;
            // A 200 override stands in for "translation not offered": a body
            // with no "events" is exactly what YouTube returns for an empty slot.
            const body = status >= 200 && status < 300 ? '{"wireMagic":"pb3"}' : '';
            return new Response(body, {
                status,
                headers: retryAfter ? { 'Retry-After': retryAfter } : {},
            });
        };
    }
    const forcedFetch = makeForcedFetch();
    const timedTextFetch = (url: string, init: RequestInit): Promise<Response> =>
        (forcedFetch ?? originalFetch)(url, init);

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

    // The live player API, not ytd-app.data.playerResponse: the latter is the
    // SSR ytInitialPlayerResponse, whose signed timedtext URLs the server
    // answers with HTTP 200 and an EMPTY body (since YouTube dropped the pot
    // parameter, ~2026-08). Only getPlayerResponse() carries URLs that serve.
    function readPlayerResponseFromPlayerApi(): PlayerResponse | null {
        try {
            const el = document.getElementById('movie_player') as
                | (HTMLElement & { getPlayerResponse?: () => PlayerResponse | null })
                | null;
            const pr = el?.getPlayerResponse?.();
            if (pr?.videoDetails?.videoId) return pr;
        } catch {
            // Player API shape is not a contract.
        }
        return null;
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

    // ytd-app stays as a last resort only — its track LIST is correct even
    // when its URLs are dead, and resolveLiveBaseUrl() swaps in a live URL at
    // fetch time anyway.
    function readPlayerResponse(): PlayerResponse | null {
        return readPlayerResponseFromPlayerApi() ?? readPlayerResponseFromYtdApp();
    }

    /**
     * The freshest signed URL for the track `baseUrl` describes, read from the
     * live player response. Falls back to the given URL when the player hasn't
     * caught up to this video or no longer lists a matching track. Called both
     * before the first request and between empty-answer re-asks, so a baseUrl
     * that went stale in flight heals without user action.
     */
    function resolveLiveBaseUrl(videoId: string, baseUrl: string): string {
        try {
            const pr = readPlayerResponseFromPlayerApi();
            if (pr?.videoDetails?.videoId !== videoId) return baseUrl;
            const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!tracks || tracks.length === 0) return baseUrl;
            const want = new URL(baseUrl, location.href).searchParams;
            const match = tracks.find((t) => {
                const have = new URL(t.baseUrl, location.href).searchParams;
                return (
                    have.get('lang') === want.get('lang') &&
                    (have.get('kind') ?? '') === (want.get('kind') ?? '')
                );
            });
            return match?.baseUrl ?? baseUrl;
        } catch {
            return baseUrl;
        }
    }

    // Watch pages only: Shorts is deliberately unsupported, so its URLs resolve
    // to no video and nothing downstream ever runs there.
    function currentUrlVideoId(): string | null {
        try {
            const p = location.pathname;
            if (p === '/watch') return new URLSearchParams(location.search).get('v');
        } catch {
            // ignore
        }
        return null;
    }

    // Resolve captions for whatever video the URL currently points at. Posts
    // tracks the moment they appear (videoId + captions ship together). Only
    // declares "no captions" once the player response has caught up to THIS
    // video (matching id) and stayed caption-less briefly — so a navigation
    // whose player response lags the URL never misfires.
    async function broadcastCurrent(): Promise<void> {
        const target = currentUrlVideoId();
        let caughtUpNoCap = 0;
        for (let i = 0; i < 70; i++) {
            // Bail if the user moved to a different video meanwhile.
            if (target && currentUrlVideoId() !== target) return;

            const pr = readPlayerResponse();
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
        // Abort in-flight fetches ONLY when the URL moved to a different video.
        // The initial boot of a watch page fires this event too — for the SAME
        // video, typically right after the first fetches start — and aborting
        // then kills a round nobody retries: the isolated world has already
        // claimed the video as loaded, and it deliberately treats 'aborted' as
        // non-news. (The pot dance used to delay fetches past this event, which
        // hid the race.)
        if (!fetchVideoId || currentUrlVideoId() !== fetchVideoId) {
            navAbort.abort();
            navAbort = new AbortController();
            inFlightFetch.clear();
        }
        setTimeout(broadcastCurrent, 200);
    });

    // ---------- native captions control ----------

    // Finds the captions toggle. The watch player uses `.ytp-subtitles-button`.
    // Buttons may be present-but-hidden — HTMLElement.click() still toggles
    // them, so visibility is fine.
    function isUnavailable(el: Element): boolean {
        return /unavailable|недоступн|недосту?пні/i.test(el.getAttribute('aria-label') || '');
    }

    function findCcButton(): HTMLElement | null {
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

    // Keep the control bar up while our player menu is open, the same way
    // YouTube's own settings menu does. wakeUpControls() is the player's own
    // API — it restarts the autohide timer from the inside, so nothing here
    // touches #movie_player's classes (which controlsFloor.ts observes: writing
    // them fed back through YouTube's observers into a loop).
    function wakeUpControls(): void {
        const player = document.getElementById('movie_player') as (HTMLElement & { wakeUpControls?: () => void }) | null;
        try {
            player?.wakeUpControls?.();
        } catch {
            // Player API shape is not a contract; a missing method just means
            // the bar autohides as usual.
        }
    }

    // ---------- timedtext fetching ----------
    // No `pot` handling anywhere here. YouTube used to require a PO token on
    // timedtext, and this script minted one by toggling CC and sniffing the
    // player's own request. As of ~2026-08 the player itself sends timedtext
    // WITHOUT pot and the endpoint serves it fine — what matters now is only
    // that the signed baseUrl comes from the LIVE player response (see
    // readPlayerResponseFromPlayerApi).

    function buildUrl(baseUrl: string, tlang?: string): string {
        const u = new URL(baseUrl, location.href);
        u.searchParams.set('fmt', 'json3');
        u.searchParams.set('c', 'WEB');
        if (tlang) u.searchParams.set('tlang', tlang);
        return u.toString();
    }

    // One breaker for every TRANSLATION track: machine translation is what
    // YouTube actually rate limits, and a tlang 429 predicts the next tlang
    // 429. Plain stored tracks bypass it — they kept serving 200s while tlang
    // answered 429, and gating them here escalated a missing translation into
    // a fully empty panel. Lives here because this is the only place that can
    // actually decline to send a request.
    const breaker = new RateLimitBreaker();

    // Duplicate YT_FETCH_VTT messages are easy to provoke (navigation races,
    // "Search again", a prefs change) and each one used to mean a fresh burst
    // of requests. Same pattern as inFlightEnsurePot above.
    const inFlightFetch = new Map<string, Promise<VttOutcome>>();

    // Abandoned when the user navigates: without this the retry loop and its
    // backoff keep running for a video nobody is watching any more.
    let navAbort = new AbortController();

    // The video the most recent YT_FETCH_VTT was for — what yt-navigate-finish
    // compares the URL against to tell "moved to another video" (abort) from
    // "same-video navigate event during boot" (leave the fetches alone).
    let fetchVideoId: string | null = null;

    function sleep(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
            if (signal?.aborted) return resolve();
            const timer = setTimeout(resolve, ms);
            // Resolve (not reject) on abort: the fetch loop checks the signal
            // itself and returns 'aborted', which keeps its control flow linear.
            signal?.addEventListener(
                'abort',
                () => {
                    clearTimeout(timer);
                    resolve();
                },
                { once: true },
            );
        });
    }

    function fetchDeduped(
        url: string,
        signal: AbortSignal,
        opts: { translation: boolean; probe: boolean; refreshUrl?: () => string },
    ): Promise<VttOutcome> {
        const existing = inFlightFetch.get(url);
        if (existing) {
            console.log(TAG, 'reusing in-flight request');
            return existing;
        }
        const p = fetchTimedText(
            url,
            {
                fetchImpl: timedTextFetch,
                sleep,
                breaker: opts.translation ? breaker : undefined,
                maxAttempts: opts.probe ? 1 : undefined,
                refreshUrl: opts.refreshUrl,
            },
            signal,
        ).finally(() => {
            inFlightFetch.delete(url);
        });
        inFlightFetch.set(url, p);
        return p;
    }

    function postResult(msg: Omit<YtVttResultMessage, 'type'>): void {
        window.postMessage({ type: 'YT_VTT_RESULT', ...msg } satisfies YtVttResultMessage, '*');
    }

    async function fetchVtt(
        reqKey: string,
        baseUrl: string,
        videoId: string,
        tlang?: string,
        probe?: boolean,
    ): Promise<void> {
        fetchVideoId = videoId;
        const signal = navAbort.signal;
        // Keyed on the built URL rather than reqKey: duplicate requests for the
        // same track produce an identical URL, which is exactly what we want to
        // collapse. The isolated world may hand us a baseUrl it read a while
        // ago (or one that came from SSR data) — swap in the live player's
        // freshly signed URL for the same track before fetching.
        const url = buildUrl(resolveLiveBaseUrl(videoId, baseUrl), tlang);
        const outcome = await fetchDeduped(url, signal, {
            translation: !!tlang,
            probe: !!probe,
            refreshUrl: () => buildUrl(resolveLiveBaseUrl(videoId, baseUrl), tlang),
        });

        if (outcome.ok) {
            console.log(TAG, 'fetched', outcome.text.length, 'bytes for', reqKey,
                outcome.attempts > 1 ? `(attempt ${outcome.attempts})` : '');
        } else {
            console.warn(TAG, 'failed', reqKey, outcome.failure, 'status:', outcome.status,
                'attempts:', outcome.attempts, tlang ? `tlang=${tlang}` : '(no tlang)');
            // 'stale-url' needs no cleanup here: the caller's "Search again"
            // re-reads the player response via YT_QUERY_CAPTIONS, which yields
            // a fresh baseUrl, and resolveLiveBaseUrl re-signs on every fetch.
        }

        postResult({
            url: reqKey,
            videoId,
            ok: outcome.ok,
            text: outcome.ok ? outcome.text : '',
            failure: outcome.failure,
            status: outcome.status,
            // Only throttle outcomes carry a cooldown. Falling back to the
            // breaker's remaining time for every failure dressed a permanent
            // 'not-offered' up as a temporary limit — the UI would then offer a
            // retry while its own copy said retrying cannot help.
            retryAfterMs: outcome.retryAfterMs || undefined,
            attempts: outcome.attempts,
            // Diagnostics for the isolated world, which reports analytics but
            // cannot see the breaker (it lives here, in the MAIN world).
            breakerStep: breaker.step(),
            translation: !!tlang,
        });
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
        if (data.type === 'YT_WAKE_CONTROLS') {
            wakeUpControls();
            return;
        }
        if (
            data.type === 'YT_FETCH_VTT' &&
            typeof data.url === 'string' &&
            typeof data.baseUrl === 'string' &&
            typeof data.videoId === 'string'
        ) {
            fetchVtt(data.url, data.baseUrl, data.videoId, data.tlang, data.probe === true);
        }
    });

    console.log(TAG, 'installed');
}
