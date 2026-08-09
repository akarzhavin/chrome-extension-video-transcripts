import {
    backoffMs,
    classifyStatus,
    EMPTY_RETRIES,
    EMPTY_RETRY_DELAY_MS,
    fetchTimedText,
    isUsableResponse,
    MAX_ATTEMPTS,
    MAX_RETRY_AFTER_MS,
    parseRetryAfter,
    RateLimitBreaker,
    type FetchDeps,
} from '../src/content/timedtext-fetch';

// A json3 body long enough to pass the length check and carrying "events".
const GOOD_BODY = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'hi' }] }] });

/** Minimal Response stand-in — fetchTimedText only touches ok/status/headers/text. */
const response = (status: number, body = '', headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => body,
});

// Typed so assertions on the sleep duration (the Retry-After test) stay checked.
type Sleep = jest.Mock<Promise<void>, [number, (AbortSignal | undefined)?]>;

const makeSleep = (impl: (ms: number, signal?: AbortSignal) => Promise<void> = async () => {}): Sleep =>
    jest.fn(impl) as Sleep;

function makeDeps(
    responses: Array<ReturnType<typeof response> | Error>,
    overrides: Partial<FetchDeps> = {},
): FetchDeps & { fetchImpl: jest.Mock; sleep: Sleep; breaker: RateLimitBreaker } {
    const queue = [...responses];
    const fetchImpl = jest.fn(async () => {
        const next = queue.shift() ?? responses[responses.length - 1];
        if (next instanceof Error) throw next;
        return next as unknown as Response;
    });
    return {
        fetchImpl,
        sleep: makeSleep(),
        breaker: new RateLimitBreaker(),
        rand: () => 0.5,
        ...overrides,
    } as FetchDeps & { fetchImpl: jest.Mock; sleep: Sleep; breaker: RateLimitBreaker };
}

describe('isUsableResponse', () => {
    test.each([
        ['empty string', '', false],
        ['too short', '{"events":[]}', false],
        ['no events key', JSON.stringify({ wireMagic: 'pb3', somethingElse: [1, 2, 3, 4] }), false],
        ['real json3 body', GOOD_BODY, true],
    ])('%s', (_label, body, expected) => {
        expect(isUsableResponse(body as string)).toBe(expected);
    });
});

describe('classifyStatus', () => {
    test.each([
        [429, 'rate-limited'],
        [503, 'rate-limited'],
        [403, 'stale-url'],
        [404, 'unavailable'],
        [410, 'unavailable'],
        [500, 'unknown'],
        [302, 'unknown'],
    ])('%i maps to %s', (status, expected) => {
        expect(classifyStatus(status as number, false)).toBe(expected);
    });

    test('200 with a usable body is success', () => {
        expect(classifyStatus(200, true)).toBeUndefined();
    });

    // The headline case: YouTube answers 200 with no events when it has no
    // machine translation for the requested language.
    test('200 with an unusable body is not-offered, not an error', () => {
        expect(classifyStatus(200, false)).toBe('not-offered');
    });
});

describe('parseRetryAfter', () => {
    const NOW = 1_700_000_000_000;

    test('delta-seconds', () => {
        expect(parseRetryAfter('3', NOW)).toBe(3000);
        expect(parseRetryAfter('0', NOW)).toBe(0);
        expect(parseRetryAfter('  5  ', NOW)).toBe(5000);
    });

    test('HTTP-date is measured against the injected clock', () => {
        const when = new Date(NOW + 5000).toUTCString();
        // toUTCString truncates to whole seconds, so allow a small window.
        expect(parseRetryAfter(when, NOW)).toBeGreaterThanOrEqual(4000);
        expect(parseRetryAfter(when, NOW)).toBeLessThanOrEqual(5000);
    });

    test('a past HTTP-date clamps to zero, never negative', () => {
        expect(parseRetryAfter(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(0);
    });

    test.each([[null], [''], ['soon'], ['-5']])('%p yields null', (header) => {
        expect(parseRetryAfter(header as string | null, NOW)).toBeNull();
    });

    test('an absurd value is clamped so we never park the page for minutes', () => {
        expect(parseRetryAfter('99999', NOW)).toBe(MAX_RETRY_AFTER_MS);
    });
});

describe('backoffMs', () => {
    test('grows exponentially at the ceiling', () => {
        const max = () => 1;
        expect(backoffMs(1, max)).toBe(400);
        expect(backoffMs(2, max)).toBe(800);
        expect(backoffMs(3, max)).toBe(1600);
    });

    test('is capped', () => {
        expect(backoffMs(20, () => 1)).toBe(8000);
    });

    test('full jitter can pick anywhere in the window', () => {
        expect(backoffMs(3, () => 0)).toBe(0);
        expect(backoffMs(3, () => 0.5)).toBe(800);
    });
});

describe('RateLimitBreaker', () => {
    let clock = 1000;
    const now = () => clock;

    beforeEach(() => {
        clock = 1000;
    });

    test('starts closed', () => {
        expect(new RateLimitBreaker(now).isOpen()).toBe(false);
    });

    test('opens for a growing window and closes when it elapses', () => {
        const b = new RateLimitBreaker(now);
        b.trip();
        expect(b.remainingMs()).toBe(30_000);
        clock += 30_000;
        expect(b.isOpen()).toBe(false);

        b.trip();
        expect(b.remainingMs()).toBe(60_000);
    });

    test('honours a Retry-After longer than its own step', () => {
        const b = new RateLimitBreaker(now);
        b.trip(90_000);
        expect(b.remainingMs()).toBe(90_000);
    });

    test('reset closes it immediately', () => {
        const b = new RateLimitBreaker(now);
        b.trip();
        b.reset();
        expect(b.isOpen()).toBe(false);
        // And the escalation restarts from the first step.
        b.trip();
        expect(b.remainingMs()).toBe(30_000);
    });
});

describe('fetchTimedText', () => {
    test('a good response returns on the first try and never sleeps', async () => {
        const deps = makeDeps([response(200, GOOD_BODY)]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: true, text: GOOD_BODY, attempts: 1 });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
        expect(deps.sleep).not.toHaveBeenCalled();
    });

    // An empty track is ambiguous: no translation exists, OR it isn't ready
    // yet. Re-ask a bounded number of times instead of giving up on the first
    // answer — but far short of hammering, since it's usually permanent.
    test('200 with no events is re-asked, then reported as not-offered', async () => {
        const deps = makeDeps([response(200, '{"wireMagic":"pb3","noEventsHere":true}')]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'not-offered' });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(EMPTY_RETRIES + 1);
        // Short fixed waits, not the rate-limit backoff — nothing is throttled.
        expect(deps.sleep).toHaveBeenCalledTimes(EMPTY_RETRIES);
        expect(deps.sleep).toHaveBeenLastCalledWith(EMPTY_RETRY_DELAY_MS, undefined);
    });

    // The case the retry exists for: YouTube serves an empty payload for the
    // first second after load, then the real track.
    test('an empty track that becomes ready is picked up by the retry', async () => {
        const deps = makeDeps([
            response(200, '{"wireMagic":"pb3"}'),
            response(200, GOOD_BODY),
        ]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: true, text: GOOD_BODY, attempts: 2 });
    });

    test('an empty answer never trips the rate-limit breaker', async () => {
        const deps = makeDeps([response(200, '{"wireMagic":"pb3"}')]);
        await fetchTimedText('u', deps);
        expect(deps.breaker.isOpen()).toBe(false);
    });

    test('429 retries to the limit and sleeps between attempts only', async () => {
        const deps = makeDeps([response(429)]);
        const out = await fetchTimedText('u', deps);
        expect(out.failure).toBe('rate-limited');
        expect(out.attempts).toBe(MAX_ATTEMPTS);
        expect(deps.fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        // No trailing sleep after the final attempt.
        expect(deps.sleep).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
        expect(deps.breaker.isOpen()).toBe(true);
        expect(out.retryAfterMs).toBeGreaterThan(0);
    });

    // Otherwise the next "Search again" fires a fresh burst at an endpoint
    // that just refused us three times.
    test('a 429 run ending in a network blip still opens the breaker', async () => {
        const deps = makeDeps([response(429), response(429), new Error('offline')]);
        const out = await fetchTimedText('u', deps);
        expect(deps.breaker.isOpen()).toBe(true);
        expect(out.failure).toBe('rate-limited');
    });

    test('Retry-After overrides the jittered backoff', async () => {
        const deps = makeDeps([response(429, '', { 'Retry-After': '2' })]);
        await fetchTimedText('u', deps);
        expect(deps.sleep).toHaveBeenNthCalledWith(1, 2000, undefined);
    });

    test('recovers when a retry succeeds, and clears the breaker', async () => {
        const deps = makeDeps([response(429), response(200, GOOD_BODY)]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: true, attempts: 2 });
        expect(deps.breaker.isOpen()).toBe(false);
    });

    test.each([
        [403, 'stale-url'],
        [404, 'unavailable'],
    ])('%i is not retried', async (status, failure) => {
        const deps = makeDeps([response(status as number)]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure, attempts: 1 });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
        expect(deps.sleep).not.toHaveBeenCalled();
    });

    test('a thrown fetch is treated as a retryable network failure', async () => {
        const deps = makeDeps([new Error('offline')]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'network' });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    test('an AbortError is aborted, not network', async () => {
        const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const deps = makeDeps([err]);
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'aborted', attempts: 1 });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('an already-aborted signal sends nothing', async () => {
        const deps = makeDeps([response(200, GOOD_BODY)]);
        const ctrl = new AbortController();
        ctrl.abort();
        const out = await fetchTimedText('u', deps, ctrl.signal);
        expect(out).toMatchObject({ failure: 'aborted', attempts: 0 });
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    test('aborting mid-backoff stops the retry loop', async () => {
        const ctrl = new AbortController();
        const deps = makeDeps([response(429)], {
            sleep: makeSleep(async () => {
                ctrl.abort();
            }),
        });
        const out = await fetchTimedText('u', deps, ctrl.signal);
        expect(out.failure).toBe('aborted');
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('an open breaker refuses without touching the network', async () => {
        const deps = makeDeps([response(200, GOOD_BODY)]);
        deps.breaker.trip();
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'cooldown', attempts: 0 });
        expect(out.retryAfterMs).toBeGreaterThan(0);
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    // Plain stored tracks pass no breaker at all: YouTube throttles machine
    // translation, and stored tracks kept serving 200s while tlang answered
    // 429 — a tlang cooldown must not block the track that still works.
    test('without a breaker, a request is never refused by a cooldown', async () => {
        const deps = makeDeps([response(200, GOOD_BODY)], { breaker: undefined });
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: true, text: GOOD_BODY, attempts: 1 });
    });

    test('without a breaker, a 429 run still reports rate-limited and finishes cleanly', async () => {
        const deps = makeDeps([response(429, '', { 'Retry-After': '2' })], { breaker: undefined });
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'rate-limited', attempts: MAX_ATTEMPTS });
        // The Retry-After survives even with no breaker to stretch it.
        expect(out.retryAfterMs).toBe(2000);
    });

    // The unattended post-cooldown probe: one request, no burst — a retry the
    // user didn't ask for must not hand YouTube fresh reasons to keep limiting.
    test('maxAttempts: 1 sends a single probe and never sleeps', async () => {
        const deps = makeDeps([response(429)], { maxAttempts: 1 });
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: false, failure: 'rate-limited', attempts: 1 });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
        expect(deps.sleep).not.toHaveBeenCalled();
        // A refused probe still re-opens the breaker for the next window.
        expect(deps.breaker.isOpen()).toBe(true);
    });

    test('a successful probe resets the breaker escalation', async () => {
        let clock = 0;
        const breaker = new RateLimitBreaker(() => clock);
        const deps = makeDeps([response(200, GOOD_BODY)], { maxAttempts: 1, breaker });
        breaker.trip(); // 30s window
        clock += 30_000; // window elapsed — the probe is allowed through
        const out = await fetchTimedText('u', deps);
        expect(out).toMatchObject({ ok: true, attempts: 1 });
        breaker.trip(); // a later throttle starts a fresh episode…
        expect(breaker.remainingMs()).toBe(30_000); // …not the escalated 60s step
    });
});
