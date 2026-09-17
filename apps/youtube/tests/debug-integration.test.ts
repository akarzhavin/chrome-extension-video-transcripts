import { DebugTrace, type StampedEvent } from '../src/content/debug-trace';
import { MainTraceSink } from '../src/content/debug-bridge';
import { TraceRecorder, type StorageLike } from '../src/content/debug-recorder';
import { fetchTimedText, RateLimitBreaker, type FetchDeps } from '../src/content/timedtext-fetch';
import { clipBody, pickHeaders } from '../src/content/debug-trace';

/**
 * The pieces, driven together against a scripted failure.
 *
 * Each unit is tested on its own elsewhere. What this adds is the claim the
 * whole feature rests on and no single unit can make: that a real failure
 * sequence, recorded across BOTH worlds and read back after a reload, answers
 * the questions someone opens the trace to ask.
 *
 * The documentation in packages/shared/docs/dev-flags.md makes exactly these
 * claims about how to read a report. A doc that describes a sequence in prose
 * drifts from the code silently; these tests are what keep it honest.
 */

const EMPTY_ENVELOPE = JSON.stringify({ wireMagic: 'pb3', somethingElse: [1, 2, 3, 4] });
const GOOD_BODY = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'hi' }] }] });

const response = (status: number, body = '', headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => body,
});

function memoryStorage(): StorageLike & { data: Record<string, unknown> } {
    const data: Record<string, unknown> = {};
    return {
        data,
        async get(key) {
            return { [key]: data[key] };
        },
        async set(items) {
            // Round-trip through JSON, the way chrome.storage actually does:
            // anything that cannot survive it would be lost in the field and
            // present in a test that shared object references.
            Object.assign(data, JSON.parse(JSON.stringify(items)));
        },
        async remove(key) {
            delete data[key];
        },
    };
}

/**
 * Both worlds, wired the way page-script.ts and debug-mode.ts wire them.
 *
 * The MAIN sink posts batches; the recorder ingests them. Timers are driven by
 * hand so the whole exchange is synchronous and assertable.
 */
function wireWorlds(
    opts: {
        storage?: ReturnType<typeof memoryStorage>;
        /**
         * Wire the session-start hook to the MAIN sink, the way debug-mode.ts
         * wires it to its `announce()`. Off by default so the tests written
         * before the hook existed keep driving `setState` by hand.
         */
        announceOnSessionStart?: boolean;
    } = {},
) {
    const storage = opts.storage ?? memoryStorage();
    let clock = 1_000_000;
    const timers: Array<() => void> = [];
    const recorder = new TraceRecorder({
        storage,
        now: () => clock,
        setTimer: (fn) => {
            timers.push(fn);
            return timers.length;
        },
        clearTimer: () => {},
        onSessionStart: opts.announceOnSessionStart
            ? () => main.setState(recorder.isEnabled(), recorder.sessionStartedAt())
            : undefined,
    });
    recorder.setEnabled(true);

    const main = new MainTraceSink({
        // The world boundary, minus the postMessage hop.
        post: (msg) => recorder.ingestFromMain(msg.events),
        now: () => clock,
        setTimer: (fn) => {
            timers.push(fn);
            return timers.length;
        },
        clearTimer: () => {},
    });

    return {
        recorder,
        main,
        storage,
        advance: (ms: number) => {
            clock += ms;
        },
        runTimers: () => {
            while (timers.length) timers.shift()!();
        },
    };
}

describe('a throttled video, end to end', () => {
    test('the report answers what was asked, what came back, and why it stopped', async () => {
        const w = wireWorlds();
        w.recorder.startSession('dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        w.main.setState(true, w.recorder.sessionStartedAt());

        // MAIN: the player response and the catalogue.
        w.main.record({ ev: 'player_response', source: 'player-api', videoId: 'dQw4w9WgXcQ', trackCount: 1, polls: 3 });
        w.main.record({ ev: 'catalog', tracks: [{ lang: 'en', name: 'English' }] });

        // ISO: what we decided to do about it.
        w.recorder.record({ ev: 'decision', decision: 'load', isShorts: false, collapsed: false });
        w.recorder.record({
            ev: 'plan',
            requests: [{ key: 'Russian', name: 'Russian', tlang: 'ru' }],
        });

        // MAIN: the real fetch loop, throttled all the way down.
        w.advance(500);
        const breaker = new RateLimitBreaker(() => 1, 1, [30_000], (e) => w.main.record(e));
        const deps: FetchDeps = {
            fetchImpl: async () => response(429, '', { 'Retry-After': '5' }) as unknown as Response,
            sleep: async () => {},
            breaker,
            traceKey: 'Russian',
            onEvent: (e) => w.main.record(e),
            readHeaders: pickHeaders,
            clipText: clipBody,
        };
        const outcome = await fetchTimedText('https://yt/api/timedtext?tlang=ru', deps);
        w.main.record({
            ev: 'outcome',
            key: 'Russian',
            ok: outcome.ok,
            failure: outcome.failure,
            status: outcome.status,
            attempts: outcome.attempts,
        });

        // ISO: the timer concludes from silence, and the verdict lands. The
        // clock has to move here: the merge sorts by `t` and keeps insertion
        // order on ties, so a batch delivered late but stamped at the same
        // instant would land after a verdict that really came later.
        w.advance(7000);
        w.recorder.record({ ev: 'timer', which: 'no-subs-stage1', pending: 1, tracks: 0 });
        w.recorder.record({ ev: 'verdict', kind: 'no-subtitles', failure: 'rate-limited', trackCount: 0 });

        w.main.flush();
        w.runTimers();

        const session = w.recorder.sessions()[0];
        const kinds = session.events.map((e) => e.ev);

        // 1. What did the video offer? (the question a bare "no subtitles" cannot answer)
        const catalog = session.events.find((e) => e.ev === 'catalog') as
            | { tracks: Array<{ lang: string }> }
            | undefined;
        expect(catalog?.tracks.map((t) => t.lang)).toEqual(['en']);

        // 2. What did we ask for? Russian by machine translation — which is the
        //    expensive thing YouTube throttles.
        const plan = session.events.find((e) => e.ev === 'plan') as
            | { requests: Array<{ tlang?: string }> }
            | undefined;
        expect(plan?.requests[0].tlang).toBe('ru');

        // 3. How many times, and what came back? The VttOutcome says "4"; the
        //    trace says which four and what each answered.
        const attempts = session.events.filter((e) => e.ev === 'attempt');
        expect(attempts).toHaveLength(4);
        const answers = session.events.filter((e) => e.ev === 'response') as Array<{ status: number }>;
        expect(answers.map((a) => a.status)).toEqual([429, 429, 429, 429]);

        // 4. Did YouTube name its own cooldown? (honoured vs our own backoff)
        const headers = (session.events.find((e) => e.ev === 'response') as { headers: Record<string, string> })
            .headers;
        expect(headers['retry-after']).toBe('5');

        // 5. Did the breaker open, and how far?
        expect(session.events.filter((e) => e.ev === 'breaker' && e.action === 'trip')).toHaveLength(1);

        // 6. And the verdict, with both worlds present in one story.
        expect(kinds[kinds.length - 1]).toBe('verdict');
        expect(new Set(session.events.map((e) => e.w))).toEqual(new Set(['main', 'iso']));
    });

    test('the sequence survives a reload, which is when it is actually read', async () => {
        const storage = memoryStorage();
        const first = wireWorlds({ storage });
        first.recorder.startSession('abc', 'https://www.youtube.com/watch?v=abc');
        first.recorder.record({ ev: 'decision', decision: 'load', isShorts: false, collapsed: false });
        first.recorder.record({ ev: 'verdict', kind: 'no-subtitles', failure: 'stale-url', trackCount: 0 });
        await first.recorder.flush();

        // The page reloads — the user's first instinct when subtitles do not
        // appear, and the moment an in-memory buffer would be lost.
        const second = wireWorlds({ storage });
        await second.recorder.hydrate();

        const revived = second.recorder.sessions()[0];
        expect(revived.videoId).toBe('abc');
        expect(revived.events.map((e) => e.ev)).toEqual(['decision', 'verdict']);
    });
});

describe('the documented pathologies are actually distinguishable', () => {
    test('a stale signed URL reads as ytd-app plus an empty 200, not as a network fault', async () => {
        const w = wireWorlds();
        w.recorder.startSession('abc', 'u');
        w.main.setState(true, w.recorder.sessionStartedAt());

        // The SSR copy lists the right tracks behind URLs the server no longer
        // honours — the signature of this failure, and invisible without the
        // `source` field.
        w.main.record({ ev: 'player_response', source: 'ytd-app', videoId: 'abc', trackCount: 2, polls: 1 });

        const deps: FetchDeps = {
            fetchImpl: async () => response(200, '') as unknown as Response,
            sleep: async () => {},
            traceKey: 'Russian',
            onEvent: (e) => w.main.record(e),
            readHeaders: pickHeaders,
            clipText: clipBody,
            // No fresher URL available: the re-ask was never going to differ.
            refreshUrl: () => 'https://yt/api/timedtext?sig=STALE',
        };
        const outcome = await fetchTimedText('https://yt/api/timedtext?sig=STALE', deps);

        w.main.flush();
        w.runTimers();

        expect(outcome.failure).toBe('stale-url');
        const events = w.recorder.sessions()[0].events;
        expect(events.find((e) => e.ev === 'player_response')).toMatchObject({ source: 'ytd-app' });
        expect(events.filter((e) => e.ev === 'response').every((r) => (r as { bytes: number }).bytes === 0)).toBe(true);
        // And the doc's tell: the URL never moved between re-asks.
        expect(events.filter((e) => e.ev === 'url_resolved').every((u) => (u as { changed: boolean }).changed === false)).toBe(true);
    });

    test('an empty answer that RESOLVES to a fresh URL is a different story', async () => {
        const w = wireWorlds();
        w.recorder.startSession('abc', 'u');
        w.main.setState(true, w.recorder.sessionStartedAt());

        let served = 0;
        const deps: FetchDeps = {
            fetchImpl: async () =>
                (served++ === 0 ? response(200, EMPTY_ENVELOPE) : response(200, GOOD_BODY)) as unknown as Response,
            sleep: async () => {},
            traceKey: 'Russian',
            onEvent: (e) => w.main.record(e),
            readHeaders: pickHeaders,
            clipText: clipBody,
            refreshUrl: () => 'https://yt/api/timedtext?sig=FRESH',
        };
        const outcome = await fetchTimedText('https://yt/api/timedtext?sig=STALE', deps);

        w.main.flush();
        w.runTimers();

        expect(outcome.ok).toBe(true);
        const resolved = w.recorder
            .sessions()[0]
            .events.filter((e) => e.ev === 'url_resolved') as Array<{ changed: boolean }>;
        expect(resolved.some((r) => r.changed)).toBe(true);
    });
});

describe('the trace stays readable when a video goes pathological', () => {
    test('a thousand retries still leave the catalogue, the plan and the verdict', () => {
        // The realistic overflow: not many videos, but one video that will not
        // stop failing. What must survive is the story's two ends.
        const trace = new DebugTrace(() => 0);
        trace.startSession('abc', 'u');

        trace.push({ ev: 'catalog', tracks: [{ lang: 'en', name: 'English' }] });
        trace.push({ ev: 'plan', requests: [{ key: 'Russian', name: 'Russian', tlang: 'ru' }] });
        for (let i = 0; i < 1000; i++) {
            trace.push({ ev: 'attempt', key: 'Russian', attempt: i, url: 'https://x', potPresent: false });
            trace.push({
                ev: 'response',
                key: 'Russian',
                attempt: i,
                status: 429,
                bytes: 0,
                headers: {},
                bodyHead: '',
            });
        }
        trace.push({ ev: 'verdict', kind: 'no-subtitles', failure: 'rate-limited', trackCount: 0 });

        const session = trace.current()!;
        const kinds = session.events.map((e) => e.ev);
        expect(kinds).toContain('catalog');
        expect(kinds).toContain('plan');
        expect(kinds).toContain('verdict');
        // And the record says what it gave up, by kind, so the gap is not silent.
        expect(Object.keys(session.dropped).sort()).toEqual(['attempt', 'response']);
    });
});

/** Guard against the merge silently dropping a world's stamps. */
describe('the two worlds land on one timeline', () => {
    test('events interleave by time, not by which world delivered them', () => {
        const w = wireWorlds();
        w.recorder.startSession('abc', 'u');
        w.main.setState(true, w.recorder.sessionStartedAt());

        w.advance(100);
        w.recorder.record({ ev: 'decision', decision: 'load', isShorts: false, collapsed: false });
        w.advance(100); // t=200, MAIN
        w.main.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });
        w.advance(100); // t=300, ISO
        w.recorder.record({ ev: 'verdict', kind: 'loaded', trackCount: 1 });

        w.main.flush();
        w.runTimers();

        const events = w.recorder.sessions()[0].events as StampedEvent[];
        expect(events.map((e) => e.t)).toEqual([100, 200, 300]);
        expect(events.map((e) => e.w)).toEqual(['iso', 'main', 'iso']);
    });

    /**
     * ...and they stay on one timeline across an SPA navigation.
     *
     * This is the case the wiring above cannot reach by hand: on YouTube the
     * second video never reloads the page, so the MAIN world keeps whatever
     * epoch it was last told. index.ts opens the new session and knows nothing
     * about the announcement, so without the recorder's session-start hook the
     * MAIN world went on subtracting the FIRST video's start — stamping its
     * events minutes into the future — and `merge()`'s sort then filed them
     * after a verdict that had already been reached.
     *
     * Note what makes the bug so quiet: every event is still present and every
     * number still looks plausible. Only the ORDER is wrong, which is the one
     * thing the trace exists to establish.
     */
    test('a navigation re-announces the epoch, so the second video is not stamped against the first', () => {
        // The isolated world's real wiring: the announcement is a consequence
        // of a session opening, exactly as debug-mode.ts arranges it.
        const w = wireWorlds({ announceOnSessionStart: true });

        w.recorder.startSession('first', 'u1');
        w.advance(100);
        w.main.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://first', potPresent: false });
        w.main.flush();
        w.runTimers();

        // Four minutes of the first video, then the user clicks the next one.
        w.advance(240_000);
        w.recorder.startSession('second', 'u2');

        w.advance(100);
        w.recorder.record({ ev: 'decision', decision: 'load', isShorts: false, collapsed: false });
        w.advance(100);
        w.main.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://second', potPresent: false });
        w.advance(100);
        w.recorder.record({ ev: 'verdict', kind: 'loaded', trackCount: 1 });
        w.main.flush();
        w.runTimers();

        const second = w.recorder.sessions()[1].events as StampedEvent[];

        // Stamped against the SECOND session: a MAIN event 200ms in, not
        // 240200ms in.
        expect(second.map((e) => e.t)).toEqual([100, 200, 300]);
        expect(second.map((e) => e.w)).toEqual(['iso', 'main', 'iso']);

        // And the order is the order things happened: the fetch attempt comes
        // before the verdict it produced.
        expect(second.map((e) => e.ev)).toEqual(['decision', 'attempt', 'verdict']);
    });
});
