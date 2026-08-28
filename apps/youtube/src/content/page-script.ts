import { installNetflixHook } from './netflix/manifest-hook';
import { isNetflix } from './site';
import {
    fetchTimedText,
    RateLimitBreaker,
    type VttOutcome,
    type YtVttResultMessage,
} from './timedtext-fetch';
import {
    PotStore,
    SharedOnce,
    buildTimedTextUrl,
    isEmptyish,
    potFromResourceTiming,
    shouldRetryWithPot,
} from './pot';

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
        // Watch pages use #movie_player; Shorts has its own #shorts-player.
        for (const id of ['movie_player', 'shorts-player']) {
            try {
                const el = document.getElementById(id) as
                    | (HTMLElement & { getPlayerResponse?: () => PlayerResponse | null })
                    | null;
                const pr = el?.getPlayerResponse?.();
                if (pr?.videoDetails?.videoId) return pr;
            } catch {
                // Player API shape is not a contract.
            }
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

    // Finds the captions toggle. Surfaces differ:
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

    // Does YouTube's OWN caption control say this video has captions? The
    // isolated world cannot answer this: the player chrome is the same DOM, but
    // the verdict belongs next to findCcButton()/isUnavailable(), which already
    // encode where the button lives and how it reports "unavailable" across
    // locales.
    //
    // Three-valued on purpose. The control is rendered late and is absent
    // outright on some surfaces, so "no button found" is not evidence that the
    // video has no captions — reporting it as 'no' would invent a mismatch, or
    // hide a real one, depending on which way we guessed. 'unknown' keeps that
    // ambiguity out of the data.
    function nativeCcState(): 'yes' | 'no' | 'unknown' {
        // findCcButton() first, and in ITS order: on Shorts the standard
        // .ytp-subtitles-button is present but reports "unavailable" while the
        // surface's real control (.ytmClosedCaptioningButtonButton) works. So
        // reading the standard button first would answer 'no' for a Short that
        // does have captions.
        if (findCcButton()) return 'yes';
        // Everything else is 'unknown', including a standard button labelled
        // "unavailable". That label is NOT YouTube saying the video has no
        // captions: measured live (see mintPotViaCcToggle), a watch page shows
        // it while the player response DOES list caption tracks, and clicking
        // it anyway mints a token. Answering 'no' here suppressed
        // subs_missed_with_cc in exactly the case the event exists to count.
        return 'unknown';
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
    // `pot` (PO token) came back. As of 2026-08-28 /api/timedtext answers a
    // request WITHOUT it as HTTP 200 with a ZERO-BYTE body — measured on a
    // logged-in profile with playabilityStatus OK, on the bare baseUrl as well
    // as ours. The same URL with `pot` returns the full track. So an empty
    // 200 now usually means "no token", not "stale link".
    //
    // The token is not ours to compute: only the player mints one, and only
    // when it fetches a caption track — which it does only while native
    // captions are ON. We read it off that request. With captions off (which
    // our own overlay arranges) the player never asks, so nothing can be
    // sniffed passively and the token has to be provoked; see
    // mintPotViaCcToggle, which runs ONLY after a request already came back
    // empty.
    //
    // Nothing here blocks on the token. That is why the previous
    // implementation was removed (9cf1f39): it waited 15s and reported
    // 'no-pot' when the sniff missed, so a missing optimisation became a total
    // outage. A request always goes out with whatever is known at the time,
    // and the token only ever improves a retry.
    const pots = new PotStore();

    // How long to give the player to mint a token AFTER our own request already
    // came back empty. Short by design: the user is staring at an empty panel,
    // and this is an optimisation on a retry, never a precondition for one.
    // How long the CC flash may last while waiting for the player to sign a
    // request. Bounded because the user sees YouTube's own captions during it.
    const POT_TOGGLE_TIMEOUT_MS = 4000;
    const POT_POLL_MS = 150;

    // Sniff both transports the player might use. These wrappers only observe:
    // they must never change what the page sends, or we would break playback to
    // fix subtitles.
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
        try {
            const raw = typeof url === 'string' ? url : url.href;
            if (pots.capture(raw, location.href)) console.log(TAG, 'captured pot (xhr)');
        } catch {
            // ignore
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return xhrOpen.apply(this, [method, url, ...rest] as any);
    };

    window.fetch = function (...args: Parameters<typeof fetch>) {
        try {
            const input = args[0];
            const raw = typeof input === 'string' ? input
                : input instanceof URL ? input.href
                : (input as Request)?.url;
            if (raw && pots.capture(raw, location.href)) console.log(TAG, 'captured pot');
        } catch {
            // ignore
        }
        return originalFetch.apply(window, args);
    };

    /** The token for this video, consulting resource timing as a late fallback. */
    function knownPot(videoId: string): string | null {
        const cached = pots.get(videoId);
        if (cached) return cached;
        try {
            const late = potFromResourceTiming(videoId, performance.getEntriesByType('resource'));
            if (late) {
                pots.remember(videoId, late);
                return late;
            }
        } catch {
            // ignore
        }
        return null;
    }

    function buildUrl(baseUrl: string, tlang?: string, pot?: string | null): string {
        return buildTimedTextUrl(baseUrl, { tlang, pot, base: location.href });
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

    /**
     * Mint a `pot` by briefly switching YouTube's own captions on.
     *
     * This is the expensive path, and it runs ONLY after a request already came
     * back empty — never speculatively. The player fetches a caption track (and
     * signs it with a token) when, and only when, native captions are turned
     * on; with them off it never asks for one, so there is nothing to sniff. So
     * for a user who does not run native captions — which is most of them, and
     * which our own overlay actively arranges by turning them off — the token
     * has to be provoked.
     *
     * Restores the previous state in a finally: the extension turns native
     * captions OFF on purpose (they would stack behind our overlay), and this
     * must not leave them on. The flash is bounded by POT_TOGGLE_TIMEOUT_MS.
     *
     * Once per video: if a toggle did not produce a token, a second one will
     * not either, and repeating it would blink the player's captions on every
     * failed track.
     */
    // One mint per video, shared by every track waiting on it. See SharedOnce.
    const potMint = new SharedOnce<string | null>();

    /**
     * The control to flip when minting a token. Unlike findCcButton() this does
     * NOT reject an "unavailable" label — see mintPotViaCcToggle — but it keeps
     * that function's surface order, because on Shorts the standard button is
     * the inert one.
     */
    function ccToggleForMinting(): HTMLElement | null {
        return (document.querySelector('.ytmClosedCaptioningButtonButton')
            ?? document.querySelector('.ytp-subtitles-button')) as HTMLElement | null;
    }

    /**
     * One mint per video, SHARED by every track waiting on it.
     *
     * Tracks are fetched in parallel (index.ts fans out the whole plan at
     * once), so on a video that needs a token they all come back empty within
     * milliseconds of each other. Handing the first caller the toggle and
     * turning the rest away returned null to them — the token existed half a
     * second later, but they had already given up, so dual subtitles collapsed
     * to a single language on every video that took this path. Everyone awaits
     * the same promise instead, and they all see the token it produces.
     */
    function mintPotViaCcToggle(videoId: string, signal: AbortSignal): Promise<string | null> {
        return potMint.run(
            videoId,
            () => doMintPotViaCcToggle(videoId, signal),
            () => knownPot(videoId),
        );
    }

    async function doMintPotViaCcToggle(videoId: string, signal: AbortSignal): Promise<string | null> {
        // NOT findCcButton(): that helper skips a control whose aria-label says
        // captions are "unavailable", which is right for its job (don't offer a
        // toggle that does nothing) and wrong here. Measured live: on a watch
        // page YouTube labels the button "Subtitles/closed captions
        // unavailable" while the player response DOES list caption tracks, and
        // clicking it anyway flips aria-pressed and produces a pot-signed
        // request. The label describes the track not being loaded yet, not the
        // video lacking captions.
        //
        // Both surfaces, in findCcButton()'s order: on Shorts the standard
        // control is the dead one and .ytmClosedCaptioningButtonButton is what
        // works, so trying only the standard button minted nothing there.
        const btn = ccToggleForMinting();
        // No control yet — the player chrome renders late and this runs seconds
        // into the page. Claiming the attempt HERE would burn the one mint this
        // video gets on a button that had not appeared, and every later track
        // and every "Search again" would then return null without ever clicking
        // the control that exists by then. Leave the video unclaimed so the next
        // attempt can try again.
        if (!btn) return null;
        // Already on: the player has fetched its track and we simply missed the
        // sniff, so a toggle would turn captions OFF and mint nothing.
        if (btn.getAttribute('aria-pressed') === 'true') return knownPot(videoId);

        // Claimed only now that a real toggle is about to happen — an attempt
        // that bailed above (no control rendered yet) stays retryable.
        potMint.complete(videoId);

        console.log(TAG, 'no pot — briefly enabling native captions to mint one');
        btn.click();
        try {
            const deadline = Date.now() + POT_TOGGLE_TIMEOUT_MS;
            while (Date.now() < deadline) {
                if (signal.aborted) break;
                const now = knownPot(videoId);
                if (now) return now;
                await sleep(POT_POLL_MS, signal);
            }
            return knownPot(videoId);
        } finally {
            // Restore the control WE clicked, and only while it is still that
            // video's control. Re-querying the DOM here would, after a
            // navigation, hand back the NEW video's button — and YouTube
            // persists the CC preference across videos, so if that one is on we
            // would switch the user's captions off on a video we never touched.
            if (currentUrlVideoId() === videoId
                && btn.isConnected
                && btn.getAttribute('aria-pressed') === 'true') {
                btn.click();
                console.log(TAG, 'native captions -> Off (restored)');
            }
        }
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
        // Every URL is built fresh from the live player response AND whatever
        // token is known right now. refreshUrl re-runs both between the
        // empty-answer re-asks inside fetchTimedText, so a pot the player mints
        // while our first request is in flight is picked up without any waiting.
        const makeUrl = () => buildUrl(resolveLiveBaseUrl(videoId, baseUrl), tlang, knownPot(videoId));
        // Snapshot BEFORE the request, not after: the player's own caption
        // request commonly lands while ours is in flight, and reading the token
        // afterwards would make a just-arrived one look like it had been there
        // all along — the retry would then be skipped in exactly the case it
        // exists for.
        const potBefore = knownPot(videoId);
        const url = makeUrl();
        let outcome = await fetchDeduped(url, signal, {
            translation: !!tlang,
            probe: !!probe,
            refreshUrl: makeUrl,
        });

        // Second way in — the cascade. An empty answer with no token in hand is
        // the signature of the pot requirement, so provoke a token and ask
        // again rather than reporting a failure the user has to click their way
        // out of (and, as it turns out, could not click their way out of: no
        // amount of "Search again" mints a token).
        //
        // Cheap path first: the request already went out without a token,
        // because most of the time that is all it takes and touching the
        // player is not free. Only an actually-empty answer escalates.
        //
        // Guarded on the token being NEW: without that this would re-send an
        // identical request and launder the same empty answer into a second
        // attempt.
        if (!outcome.ok && !signal.aborted && !potBefore && isEmptyish(outcome.failure)) {
            const late = await mintPotViaCcToggle(videoId, signal);
            if (shouldRetryWithPot(outcome.failure, potBefore, late)) {
                console.log(TAG, 'retrying with a freshly captured pot for', reqKey);
                outcome = await fetchDeduped(makeUrl(), signal, {
                    translation: !!tlang,
                    probe: !!probe,
                    refreshUrl: makeUrl,
                });
            }
        }

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
        if (data.type === 'YT_QUERY_NATIVE_CC') {
            window.postMessage(
                { type: 'YT_NATIVE_CC_STATE', videoId: currentUrlVideoId(), state: nativeCcState() },
                '*',
            );
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
