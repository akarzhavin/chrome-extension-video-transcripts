// ── YouTube timedtext fetching: classify, back off, give up ─────────────────
// Extracted from page-script.ts so the retry/classification rules are unit
// testable without a MAIN-world page. Everything here is pure or takes its
// side effects (fetch, sleep, randomness, clock) through injected deps.
//
// Why this exists: /api/timedtext with `tlang=` runs a machine translation and
// is far more expensive for YouTube than serving a stored track, so it rate
// limits (HTTP 429) per IP/session. The old code stringified the status into
// `Error('HTTP ' + status)` and retried everything four times, which meant a
// throttled request and a permanently-absent track were indistinguishable —
// and the most common non-error case (YouTube offers no translation for the
// requested language) burned all four attempts before failing silently.

/** Why a timedtext request did not produce usable subtitles. */
export type VttFailure =
    | 'rate-limited' // 429/503. Retryable with backoff, then the breaker opens.
    | 'stale-url' // 403. The signed baseUrl or the pot expired.
    | 'not-offered' // HTTP 200 with no events — no translation for this lang.
    | 'no-pot' // never minted a pot for this video (CC toggle never worked).
    | 'unavailable' // 404/410. The track is gone.
    // No reply ever came back (a wedged page-script, a dropped
    // postMessage). Distinct from 'network', which means a request was
    // made and failed.
    | 'timeout'
    | 'network' // fetch() threw (offline, CORS).
    | 'cooldown' // breaker open; we did not even send the request.
    | 'aborted' // the user navigated away.
    | 'unknown'; // any other non-ok status.

export interface VttOutcome {
    ok: boolean;
    text: string;
    failure?: VttFailure;
    /** Raw HTTP status, kept for logs and triage. */
    status?: number;
    /** ms until a retry is worth attempting (rate-limited / cooldown only). */
    retryAfterMs?: number;
    /** How many network requests were actually sent. */
    attempts: number;
}

/** Failures where sending the same request again could plausibly succeed. */
const RETRYABLE: ReadonlySet<VttFailure> = new Set<VttFailure>([
    'rate-limited',
    'network',
    'unknown',
]);

export const isRetryable = (f: VttFailure): boolean => RETRYABLE.has(f);

/** Never park a promise in the page for longer than this, whatever YouTube says. */
export const MAX_RETRY_AFTER_MS = 60_000;

export const MAX_ATTEMPTS = 4;

/**
 * How many times to re-ask when the answer is a well-formed but empty track.
 *
 * An empty json3 body means one of two things and the response cannot tell
 * them apart: YouTube has no translation for this language (permanent), or the
 * track exists but isn't ready yet (transient — the caption endpoint commonly
 * serves an empty payload for the first second or two after a video loads).
 * Treating it as permanent on the first answer means the subtitles that WOULD
 * have arrived a moment later never load at all.
 *
 * So: retry, but cheaply. A short fixed delay, not the rate-limit backoff —
 * this isn't a throttle and the user is staring at an empty panel.
 */
export const EMPTY_RETRIES = 2;
export const EMPTY_RETRY_DELAY_MS = 700;

/**
 * Is this response body worth parsing? A json3 payload with no `events` is what
 * YouTube returns for a translation slot it cannot fill, so it reads as HTTP
 * 200 but carries no subtitles.
 */
export function isUsableResponse(text: string): boolean {
    if (!text || text.length < 20) return false;
    if (!text.includes('"events"')) return false;
    return true;
}

/**
 * Map one HTTP response onto the taxonomy. `undefined` means success.
 * `bodyLooksUsable` is only consulted for 2xx — a 429 body is never subtitles.
 */
export function classifyStatus(status: number, bodyLooksUsable: boolean): VttFailure | undefined {
    // 503: YouTube sheds load this way too, and it means the same to us.
    if (status === 429 || status === 503) return 'rate-limited';
    if (status === 403) return 'stale-url';
    if (status === 404 || status === 410) return 'unavailable';
    if (status < 200 || status >= 300) return 'unknown';
    return bodyLooksUsable ? undefined : 'not-offered';
}

/**
 * RFC 7231 Retry-After: either delta-seconds or an HTTP-date. Returns ms, or
 * null when the header is absent/unparseable. Clamped to MAX_RETRY_AFTER_MS.
 */
export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (trimmed === '') return null;
    const secs = Number(trimmed);
    if (Number.isFinite(secs)) {
        if (secs < 0) return null;
        return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
    }
    const when = Date.parse(trimmed);
    if (Number.isNaN(when)) return null;
    return Math.min(Math.max(when - nowMs, 0), MAX_RETRY_AFTER_MS);
}

export interface BackoffOpts {
    baseMs?: number;
    capMs?: number;
    factor?: number;
}

/**
 * Full-jitter exponential backoff: a random point in [0, ceiling]. Full jitter
 * rather than "exponential + a little noise" because several tabs throttled at
 * the same moment must not re-collide on the same retry instant.
 */
export function backoffMs(
    attempt: number,
    rand: () => number = Math.random,
    { baseMs = 400, capMs = 8000, factor = 2 }: BackoffOpts = {},
): number {
    const ceiling = Math.min(capMs, baseMs * Math.pow(factor, Math.max(0, attempt - 1)));
    return Math.round(rand() * ceiling);
}

/**
 * Opens after a rate-limit exhaustion and stays open for a growing window, so
 * repeated "Search again" clicks cannot keep hammering an endpoint that has
 * already refused us.
 *
 * Scope: translation (`tlang=`) requests only — plain track requests skip the
 * breaker entirely (FetchDeps.breaker is optional). Machine translation is the
 * expensive operation YouTube actually throttles; stored tracks kept serving
 * with 200s while tlang answered 429 in the field, and gating them on a tlang
 * 429 turned a quiet "translation limited" notice into a full "no subtitles"
 * banner over a track YouTube was happy to serve.
 *
 * Deliberately in-memory and per-tab — no persistence, matching the decision
 * not to cache anything about timedtext across sessions.
 */
export class RateLimitBreaker {
    private openUntil = 0;
    private consecutive = 0;

    constructor(
        private now: () => number = Date.now,
        private readonly threshold = 1,
        private readonly steps: readonly number[] = [30_000, 60_000, 120_000, 300_000],
    ) {}

    remainingMs(): number {
        return Math.max(0, this.openUntil - this.now());
    }

    isOpen(): boolean {
        return this.remainingMs() > 0;
    }

    /** Record a rate-limit exhaustion; may open the breaker. */
    trip(retryAfterMs?: number): void {
        this.consecutive++;
        if (this.consecutive < this.threshold) return;
        const idx = Math.min(this.consecutive - this.threshold, this.steps.length - 1);
        const step = this.steps[idx];
        this.openUntil = this.now() + Math.max(step, retryAfterMs ?? 0);
    }

    /**
     * How deep the escalation has gone: 0 when the breaker never tripped, then
     * 1..steps.length as the windows widen. Reported with the rate-limit
     * analytics event so a brief hiccup is distinguishable from a client that
     * YouTube has decided to hold down for five minutes.
     */
    step(): number {
        if (this.consecutive < this.threshold) return 0;
        return Math.min(this.consecutive - this.threshold, this.steps.length - 1) + 1;
    }

    /** Any success means the throttling lifted. */
    reset(): void {
        this.consecutive = 0;
        this.openUntil = 0;
    }
}

export interface FetchDeps {
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
    /** Must resolve early when the signal aborts, or aborting only cuts the network leg. */
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    /**
     * Omit for requests YouTube doesn't throttle (plain stored tracks): they
     * then neither consult nor trip the breaker. See RateLimitBreaker's scope
     * note.
     */
    breaker?: RateLimitBreaker;
    /**
     * Cap on network attempts for this call; defaults to MAX_ATTEMPTS. 1 turns
     * the call into a probe — a single request with no retry burst, used by the
     * automatic post-cooldown retry so it cannot worsen the very rate limiting
     * it is checking on.
     */
    maxAttempts?: number;
    rand?: () => number;
    now?: () => number;
}

const isAbortError = (e: unknown): boolean =>
    !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';

/**
 * Fetch one timedtext URL, retrying only what is worth retrying.
 *
 * Non-retryable outcomes return after a single request — notably 'not-offered',
 * which is the common "YouTube has no machine translation for this language"
 * case and used to cost four requests plus ~4s of backoff.
 */
export async function fetchTimedText(
    url: string,
    deps: FetchDeps,
    signal?: AbortSignal,
): Promise<VttOutcome> {
    const {
        fetchImpl,
        sleep,
        breaker,
        maxAttempts = MAX_ATTEMPTS,
        rand = Math.random,
        now = Date.now,
    } = deps;

    const cooling = breaker?.remainingMs() ?? 0;
    if (cooling > 0) {
        return { ok: false, text: '', failure: 'cooldown', retryAfterMs: cooling, attempts: 0 };
    }
    if (signal?.aborted) return { ok: false, text: '', failure: 'aborted', attempts: 0 };

    let attempts = 0;
    let failure: VttFailure = 'unknown';
    let status: number | undefined;
    let retryAfterMs: number | undefined;
    let emptyAnswers = 0;
    let sawRateLimit = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        retryAfterMs = undefined;
        try {
            const res = await fetchImpl(url, { credentials: 'include', signal });
            attempts = attempt;
            status = res.status;

            if (res.ok) {
                const text = await res.text();
                const cls = classifyStatus(res.status, isUsableResponse(text));
                if (!cls) {
                    breaker?.reset();
                    return { ok: true, text, status: res.status, attempts };
                }
                // An empty track may just not be ready yet — give it a couple of
                // cheap re-asks before calling it "not offered". See EMPTY_RETRIES.
                if (++emptyAnswers > EMPTY_RETRIES || attempt >= maxAttempts) {
                    return { ok: false, text: '', failure: cls, status: res.status, attempts };
                }
                breaker?.reset(); // a 200 is not a throttle, whatever it contains
                await sleep(EMPTY_RETRY_DELAY_MS, signal);
                if (signal?.aborted) return { ok: false, text: '', failure: 'aborted', attempts };
                continue;
            }

            failure = classifyStatus(res.status, false) ?? 'unknown';
            if (failure === 'rate-limited') {
                sawRateLimit = true;
                retryAfterMs = parseRetryAfter(res.headers?.get?.('Retry-After') ?? null, now()) ?? undefined;
            }
            if (!isRetryable(failure)) {
                return { ok: false, text: '', failure, status: res.status, attempts };
            }
        } catch (e) {
            attempts = attempt;
            if (isAbortError(e) || signal?.aborted) {
                return { ok: false, text: '', failure: 'aborted', attempts };
            }
            failure = 'network';
            status = undefined;
        }

        if (signal?.aborted) return { ok: false, text: '', failure: 'aborted', attempts };
        // No sleep after the final attempt — the old loop always slept, wasting
        // over a second before reporting a failure the user was waiting on.
        if (attempt < maxAttempts) {
            await sleep(retryAfterMs ?? backoffMs(attempt, rand), signal);
            if (signal?.aborted) return { ok: false, text: '', failure: 'aborted', attempts };
        }
    }

    // Keyed on "was rate limiting seen at all", not on the last attempt's
    // verdict: 429, 429, then a network blip would otherwise leave the breaker
    // closed and let the next "Search again" fire a full fresh burst at an
    // endpoint that just refused us three times.
    if (sawRateLimit) {
        breaker?.trip(retryAfterMs);
        retryAfterMs = breaker?.remainingMs() || retryAfterMs;
        failure = 'rate-limited';
    }
    return { ok: false, text: '', failure, status, retryAfterMs, attempts };
}

// ── the MAIN → isolated world message ───────────────────────────────────────
// Shared so both bundles agree on the shape. Additive over the original
// {url, text} form: a receiver that only reads `text` still works.
export interface YtVttResultMessage {
    type: 'YT_VTT_RESULT';
    /** The request key the isolated world filed this fetch under. */
    url: string;
    /** Lets the receiver drop results for a video the user already left. */
    videoId?: string;
    /** Always '' when ok is false. */
    text: string;
    ok: boolean;
    failure?: VttFailure;
    status?: number;
    retryAfterMs?: number;
    attempts?: number;
    /**
     * The breaker's escalation depth at the time of the failure. Carried across
     * the world boundary because the breaker lives in the MAIN world and the
     * isolated-world app — which reports analytics — cannot see it.
     */
    breakerStep?: number;
    /** True when this was a machine-translation (tlang=) request. */
    translation?: boolean;
}
