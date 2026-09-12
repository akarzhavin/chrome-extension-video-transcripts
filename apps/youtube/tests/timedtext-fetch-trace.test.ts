import {
    EMPTY_RETRIES,
    EMPTY_RETRY_DELAY_MS,
    fetchTimedText,
    MAX_ATTEMPTS,
    RateLimitBreaker,
    type FetchDeps,
} from '../src/content/timedtext-fetch';
import { BODY_HEAD_BYTES, clipBody, pickHeaders, type FetchTraceEvent } from '../src/content/debug-trace';

/**
 * What the retry loop reports about itself.
 *
 * Deliberately a SEPARATE file from timedtext-fetch.test.ts: that suite pins
 * the fetching behaviour, this one pins what an observer can learn about it,
 * and mixing the two would make a behaviour regression and a diagnostics
 * regression indistinguishable at a glance in the run output.
 *
 * The claim under test throughout: the sequence inside fetchTimedText is
 * invisible from its return value. `VttOutcome` reports `attempts: 3` and
 * nothing about what those three attempts were, which URL each used, what came
 * back, or how long the loop slept between them.
 */

const GOOD_BODY = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'hi' }] }] });
/** A json3 envelope with no events — YouTube's "no translation for this language". */
const EMPTY_ENVELOPE = JSON.stringify({ wireMagic: 'pb3', somethingElse: [1, 2, 3, 4] });

const response = (status: number, body = '', headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => body,
});

type Sleep = jest.Mock<Promise<void>, [number, (AbortSignal | undefined)?]>;

function makeDeps(
    responses: Array<ReturnType<typeof response> | Error>,
    overrides: Partial<FetchDeps> = {},
): FetchDeps & { fetchImpl: jest.Mock; sleep: Sleep; events: FetchTraceEvent[] } {
    const queue = [...responses];
    const fetchImpl = jest.fn(async () => {
        const next = queue.shift() ?? responses[responses.length - 1];
        if (next instanceof Error) throw next;
        return next as unknown as Response;
    });
    const events: FetchTraceEvent[] = [];
    return {
        fetchImpl,
        sleep: jest.fn(async (_ms: number, _signal?: AbortSignal) => {}) as Sleep,
        rand: () => 0.5,
        traceKey: 'Russian',
        onEvent: (e: FetchTraceEvent) => events.push(e),
        // The formatters travel WITH the sink (see FetchDeps.readHeaders):
        // importing them into the fetcher would ship them to production.
        readHeaders: pickHeaders,
        clipText: (t: string) => clipBody(t),
        events,
        ...overrides,
    } as FetchDeps & { fetchImpl: jest.Mock; sleep: Sleep; events: FetchTraceEvent[] };
}

const kinds = (events: FetchTraceEvent[]): string[] => events.map((e) => e.ev);

describe('the empty-body re-ask leaves a trace', () => {
    test('every attempt is named, not just counted', async () => {
        // Three identical empty envelopes: the loop re-asks EMPTY_RETRIES times
        // before giving up, and the caller sees only the final verdict.
        const deps = makeDeps([
            response(200, EMPTY_ENVELOPE),
            response(200, EMPTY_ENVELOPE),
            response(200, EMPTY_ENVELOPE),
        ]);

        const outcome = await fetchTimedText('https://yt/api/timedtext?lang=ru', deps);

        // What the RETURN VALUE says: a number.
        expect(outcome.ok).toBe(false);
        expect(outcome.attempts).toBe(EMPTY_RETRIES + 1);

        // What the TRACE says: each request, each answer, each wait between.
        expect(kinds(deps.events)).toEqual([
            'attempt',
            'response',
            'retry_sleep',
            'url_resolved',
            'attempt',
            'response',
            'retry_sleep',
            'url_resolved',
            'attempt',
            'response',
        ]);

        const attempts = deps.events.filter((e) => e.ev === 'attempt');
        expect(attempts.map((a) => (a as { attempt: number }).attempt)).toEqual([1, 2, 3]);
        // Correlated with the track, so a two-track video's events can be told apart.
        expect(attempts.every((a) => (a as { key: string }).key === 'Russian')).toBe(true);
    });

    test('the empty-retry delay is reported, and matches the sleep actually taken', async () => {
        const deps = makeDeps([response(200, EMPTY_ENVELOPE), response(200, GOOD_BODY)]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        const sleeps = deps.events.filter((e) => e.ev === 'retry_sleep');
        expect(sleeps).toHaveLength(1);
        expect(sleeps[0]).toMatchObject({ ms: EMPTY_RETRY_DELAY_MS, reason: 'empty' });
        // Cross-checked against a DIFFERENT observer — the injected sleep — so
        // the assertion does not rest on the reporting it is testing.
        expect(deps.sleep).toHaveBeenCalledWith(EMPTY_RETRY_DELAY_MS, undefined);
    });

    test('whether the re-signed URL actually moved is recorded', async () => {
        // The diagnostic question behind a repeated empty 200: was the re-ask
        // ever going to be answered differently, or did we ask the same URL twice?
        const deps = makeDeps([response(200, EMPTY_ENVELOPE), response(200, GOOD_BODY)], {
            refreshUrl: () => 'https://yt/api/timedtext?sig=FRESH',
        });

        await fetchTimedText('https://yt/api/timedtext?sig=STALE', deps);

        const resolved = deps.events.filter((e) => e.ev === 'url_resolved');
        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({ changed: true, url: 'https://yt/api/timedtext?sig=FRESH' });
    });

    test('a refreshUrl that returns the same URL is reported as unchanged', async () => {
        const same = 'https://yt/api/timedtext?sig=STALE';
        const deps = makeDeps([response(200, EMPTY_ENVELOPE), response(200, GOOD_BODY)], {
            refreshUrl: () => same,
        });

        await fetchTimedText(same, deps);

        expect(deps.events.filter((e) => e.ev === 'url_resolved')[0]).toMatchObject({ changed: false });
    });
});

describe('throttling', () => {
    test('the Retry-After header is captured and drives the reported wait', async () => {
        const deps = makeDeps([
            response(429, '', { 'Retry-After': '5' }),
            response(200, GOOD_BODY),
        ]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        const res = deps.events.find((e) => e.ev === 'response') as { headers: Record<string, string> };
        expect(res.headers['retry-after']).toBe('5');

        const sleeps = deps.events.filter((e) => e.ev === 'retry_sleep');
        expect(sleeps[0]).toMatchObject({ ms: 5000, reason: 'retry-after' });
        expect(deps.sleep).toHaveBeenCalledWith(5000, undefined);
    });

    test('a backoff wait is labelled as such, distinct from an honoured Retry-After', async () => {
        // No Retry-After header: the loop falls back to its own jittered backoff.
        const deps = makeDeps([response(429), response(200, GOOD_BODY)]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        expect(deps.events.filter((e) => e.ev === 'retry_sleep')[0]).toMatchObject({ reason: 'backoff' });
    });

    test('the breaker trip is recorded with the escalation step it reached', async () => {
        const breaker = new RateLimitBreaker(Date.now, 1, [30_000], (e) => trips.push(e));
        const trips: FetchTraceEvent[] = [];
        const deps = makeDeps([response(429), response(429), response(429), response(429)], { breaker });

        await fetchTimedText('https://yt/api/timedtext', deps);

        const tripped = trips.filter((e) => e.ev === 'breaker' && e.action === 'trip');
        expect(tripped).toHaveLength(1);
        expect(tripped[0]).toMatchObject({ action: 'trip', step: 1 });
        expect((tripped[0] as { remainingMs: number }).remainingMs).toBeGreaterThan(0);
    });

    test('a request refused by an open breaker is recorded, so the gap is not read as a lost message', async () => {
        const breaker = new RateLimitBreaker();
        breaker.trip(); // open it
        const events: FetchTraceEvent[] = [];
        const deps = makeDeps([response(200, GOOD_BODY)], {
            breaker,
            onEvent: (e: FetchTraceEvent) => events.push(e),
        });

        const outcome = await fetchTimedText('https://yt/api/timedtext', deps);

        expect(outcome.failure).toBe('cooldown');
        expect(deps.fetchImpl).not.toHaveBeenCalled();
        // Exactly one event, and it explains the absence of the request.
        expect(events.filter((e) => e.ev === 'breaker' && e.action === 'blocked')).toHaveLength(1);
        expect(events.filter((e) => e.ev === 'attempt')).toHaveLength(0);
    });

    test('a plain 200 does not emit a breaker reset, so the trace is not buried in no-ops', async () => {
        const events: FetchTraceEvent[] = [];
        const breaker = new RateLimitBreaker(Date.now, 1, [30_000], (e) => events.push(e));
        const deps = makeDeps([response(200, GOOD_BODY)], { breaker });

        await fetchTimedText('https://yt/api/timedtext', deps);

        // reset() runs on every success; only one that LIFTS something reports.
        expect(events.filter((e) => e.ev === 'breaker')).toHaveLength(0);
    });

    test('a reset that actually lifts a trip is reported', async () => {
        const events: FetchTraceEvent[] = [];
        const breaker = new RateLimitBreaker(() => 0, 1, [30_000], (e) => events.push(e));
        breaker.trip();

        breaker.reset();

        expect(events.filter((e) => e.ev === 'breaker' && e.action === 'reset')).toHaveLength(1);
    });
});

describe('response bodies', () => {
    test('the body head is capped while the true length is still reported', async () => {
        // A body far past the cap: the trace must not carry it whole, and must
        // not pretend the response was small either.
        const huge = '{"events":[' + 'x'.repeat(100_000) + ']}';
        const deps = makeDeps([response(200, huge)]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        const res = deps.events.find((e) => e.ev === 'response') as { bodyHead: string; bytes: number };
        expect(res.bytes).toBe(huge.length);
        expect(res.bodyHead.length).toBeLessThan(huge.length);
        expect(res.bodyHead.startsWith(huge.slice(0, BODY_HEAD_BYTES))).toBe(true);
    });

    test('the classification is recorded next to the body that produced it', async () => {
        const deps = makeDeps([response(200, EMPTY_ENVELOPE), response(200, EMPTY_ENVELOPE), response(200, EMPTY_ENVELOPE)]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        const answers = deps.events.filter((e) => e.ev === 'response');
        // Every one of them was a 200 that carried no subtitles.
        expect(answers.every((a) => (a as { status: number }).status === 200)).toBe(true);
        expect(answers.every((a) => (a as { classified?: string }).classified === 'not-offered')).toBe(true);
    });

    test('a non-2xx answer is recorded without inventing a body', async () => {
        const deps = makeDeps([response(404)]);

        await fetchTimedText('https://yt/api/timedtext', deps);

        expect(deps.events.find((e) => e.ev === 'response')).toMatchObject({
            status: 404,
            bytes: 0,
            bodyHead: '',
            classified: 'unavailable',
        });
    });

    test('headers are read through .get(), which is all a Response stand-in implements', async () => {
        // The trap this pins: an implementation using entries()/spread would
        // return {} here and work in Chrome — green tests over a blind recorder.
        const entries = jest.fn();
        const deps = makeDeps([], {
            fetchImpl: jest.fn(async () => ({
                ok: true,
                status: 200,
                headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null), entries },
                text: async () => GOOD_BODY,
            })) as unknown as FetchDeps['fetchImpl'],
        });

        await fetchTimedText('https://yt/api/timedtext', deps);

        const res = deps.events.find((e) => e.ev === 'response') as { headers: Record<string, string> };
        expect(res.headers).toEqual({ 'content-type': 'application/json' });
        expect(entries).not.toHaveBeenCalled();
    });
});

describe('the sink changes nothing about the fetching itself', () => {
    test('an identical run with and without onEvent produces the same outcome', async () => {
        const scenario = () => [
            response(429, '', { 'Retry-After': '1' }),
            response(200, EMPTY_ENVELOPE),
            response(200, GOOD_BODY),
        ];

        const traced = makeDeps(scenario());
        const untraced = makeDeps(scenario(), { onEvent: undefined, traceKey: undefined });

        const a = await fetchTimedText('https://yt/api/timedtext', traced);
        const b = await fetchTimedText('https://yt/api/timedtext', untraced);

        // This is the "no production behaviour change" claim, asserted rather
        // than assumed: production passes no sink, and must fetch identically.
        expect(b).toEqual(a);
        expect(untraced.fetchImpl.mock.calls.length).toBe(traced.fetchImpl.mock.calls.length);
        expect(untraced.sleep.mock.calls).toEqual(traced.sleep.mock.calls);
        expect(untraced.events).toHaveLength(0);
    });

    test('a full retry burst still stops at MAX_ATTEMPTS with the sink attached', async () => {
        const deps = makeDeps([response(429), response(429), response(429), response(429), response(429)]);

        const outcome = await fetchTimedText('https://yt/api/timedtext', deps);

        expect(outcome.attempts).toBe(MAX_ATTEMPTS);
        expect(deps.events.filter((e) => e.ev === 'attempt')).toHaveLength(MAX_ATTEMPTS);
    });
});
