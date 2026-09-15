import {
    BODY_HEAD_BYTES,
    clipBody,
    DebugTrace,
    MAX_EVENTS_PER_SESSION,
    MAX_SESSIONS,
    PROTECTED_KINDS,
    SESSION_BODY_BUDGET,
    type StampedEvent,
} from '../src/content/debug-trace';

/**
 * A clock the test drives by hand. The recorder stamps every event with the
 * time since its session opened, and a real clock would make those stamps
 * unassertable.
 */
function fakeClock(start = 1_000_000) {
    let t = start;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
    };
}

const response = (bodyHead: string, attempt = 1) =>
    ({
        ev: 'response' as const,
        key: 'k',
        attempt,
        status: 200,
        bytes: bodyHead.length,
        headers: {},
        bodyHead,
    });

describe('sessions are a ring, keyed by video', () => {
    test(`keeps only the last ${MAX_SESSIONS} videos`, () => {
        const trace = new DebugTrace(fakeClock().now);
        for (let i = 0; i < MAX_SESSIONS + 3; i++) {
            trace.startSession(`video${i}`, `https://youtube.com/watch?v=video${i}`);
        }

        const ids = trace.all().map((s) => s.videoId);
        expect(ids).toEqual(['video3', 'video4', 'video5', 'video6', 'video7', 'video8']);
    });

    test('re-opening the same video keeps the session, so "Search again" stays in one story', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'https://youtube.com/watch?v=abc');
        trace.push({ ev: 'request', key: 'k', probe: false });

        // What "Search again" does: same video, a second pass.
        trace.startSession('abc', 'https://youtube.com/watch?v=abc');
        trace.push({ ev: 'request', key: 'k', probe: false });

        expect(trace.all()).toHaveLength(1);
        expect(trace.current()!.events).toHaveLength(2);
    });

    test('events arriving before any session opens are dropped, not filed under the previous video', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.push({ ev: 'no_captions', videoId: 'orphan' });

        expect(trace.all()).toHaveLength(0);
    });
});

describe('event stamping', () => {
    test('t is milliseconds since the session opened, not wall clock', () => {
        const clock = fakeClock(5_000_000);
        const trace = new DebugTrace(clock.now);
        trace.startSession('abc', 'u');

        clock.advance(250);
        trace.push({ ev: 'request', key: 'k', probe: false });
        clock.advance(1_130);
        trace.push({ ev: 'outcome', key: 'k', ok: true, attempts: 1 });

        expect(trace.current()!.events.map((e) => e.t)).toEqual([250, 1380]);
    });

    test('records which world saw the event', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');
        trace.push({ ev: 'request', key: 'k', probe: false }, 'iso');
        trace.push({ ev: 'pot', action: 'sniffed', present: true }, 'main');

        expect(trace.current()!.events.map((e) => e.w)).toEqual(['iso', 'main']);
    });
});

describe('merging the MAIN world batch', () => {
    test('interleaves by time rather than appending the batch at the end', () => {
        const clock = fakeClock();
        const trace = new DebugTrace(clock.now);
        trace.startSession('abc', 'u');

        // The isolated world records at t=100 and t=900...
        clock.advance(100);
        trace.push({ ev: 'request', key: 'k', probe: false }, 'iso');
        clock.advance(800);
        trace.push({ ev: 'received', key: 'k', stale: false, bytes: 12 }, 'iso');

        // ...while the MAIN world's batch, delivered afterwards, happened between.
        trace.merge([
            { ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false, t: 300, w: 'main' },
            { ev: 'outcome', key: 'k', ok: true, attempts: 1, t: 700, w: 'main' },
        ] as StampedEvent[]);

        expect(trace.current()!.events.map((e) => e.t)).toEqual([100, 300, 700, 900]);
    });
});

describe('caps keep one bad video from evicting the others', () => {
    test(`drops oldest past ${MAX_EVENTS_PER_SESSION} events and counts what was lost, by kind`, () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');

        const total = MAX_EVENTS_PER_SESSION + 25;
        for (let i = 0; i < total; i++) {
            trace.push({ ev: 'request', key: `k${i}`, probe: false });
        }

        const session = trace.current()!;
        expect(session.events).toHaveLength(MAX_EVENTS_PER_SESSION);
        expect(session.dropped).toEqual({ request: 25 });
        // The SURVIVORS are the newest, which is the half worth keeping: the
        // verdict is at the end of the sequence, not the beginning.
        expect((session.events[session.events.length - 1] as { key: string }).key).toBe(`k${total - 1}`);
    });

    test('the skeleton survives a retry flood that overflows the session', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');

        // The story opens: what the video had, and what we decided to ask for.
        trace.push({ ev: 'catalog', tracks: [{ lang: 'en', name: 'English' }] });
        trace.push({ ev: 'plan', requests: [{ key: 'k', name: 'Russian', tlang: 'ru' }] });

        // Then a retry burst large enough to overflow the session on its own.
        for (let i = 0; i < MAX_EVENTS_PER_SESSION + 50; i++) {
            trace.push({ ev: 'attempt', key: 'k', attempt: i, url: 'https://x', potPresent: false });
        }

        // And the answer.
        trace.push({ ev: 'verdict', kind: 'no-subtitles', failure: 'rate-limited', trackCount: 0 });

        const session = trace.current()!;
        expect(session.events).toHaveLength(MAX_EVENTS_PER_SESSION);
        // Both ends of the story are still readable: what was asked, and what
        // came back. Plain oldest-first eviction would have taken the catalog
        // and the plan, leaving a wall of identical failures explaining nothing.
        const kinds = session.events.map((e) => e.ev);
        expect(kinds).toContain('catalog');
        expect(kinds).toContain('plan');
        expect(kinds).toContain('verdict');
        // Only the volume was surrendered, and the record says so. 453 events
        // were pushed (catalog + plan + 450 attempts + verdict) against a cap of
        // 400, and every one of the 53 evictions came out of the attempts.
        expect(session.dropped).toEqual({ attempt: 53 });
    });

    test('protected events are evicted too once nothing else is left, so the cap still holds', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');

        // A session made ENTIRELY of protected events — a breaker tripping over
        // and over. If protection were absolute this buffer would grow forever.
        const total = MAX_EVENTS_PER_SESSION + 10;
        for (let i = 0; i < total; i++) {
            trace.push({ ev: 'breaker', action: 'trip', step: i, remainingMs: 1000 });
        }

        const session = trace.current()!;
        expect(session.events).toHaveLength(MAX_EVENTS_PER_SESSION);
        expect(session.dropped).toEqual({ breaker: 10 });
        // The newest survive, so the most recent escalation is the one on file.
        expect((session.events[session.events.length - 1] as { step: number }).step).toBe(total - 1);
    });

    test('every kind the trace can record is classified as skeleton or volume deliberately', () => {
        // PROTECTED_KINDS is a judgement about which events are worth keeping
        // when the buffer overflows. A kind added to the union later inherits
        // "evictable" silently — which is the right default, but it should be a
        // decision someone made rather than one that happened. Pinning the set
        // means widening or narrowing it shows up as a deliberate edit.
        expect([...PROTECTED_KINDS].sort()).toEqual([
            'breaker',
            'catalog',
            'decision',
            'nav',
            'no_captions',
            'outcome',
            'plan',
            'player_response',
            'verdict',
        ]);
    });

    test('over the body budget, bodies are blanked oldest-first while the sequence survives', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');

        const body = 'x'.repeat(BODY_HEAD_BYTES);
        const needed = Math.ceil(SESSION_BODY_BUDGET / BODY_HEAD_BYTES) + 4;
        for (let i = 0; i < needed; i++) trace.push(response(body, i + 1));

        const events = trace.current()!.events;
        // Nothing was dropped — every attempt is still in the record.
        expect(events).toHaveLength(needed);
        expect(trace.current()!.dropped).toEqual({});
        // The newest body is intact; the oldest was surrendered to the budget.
        expect((events[events.length - 1] as { bodyHead: string }).bodyHead).toBe(body);
        expect((events[0] as { bodyHead: string }).bodyHead).toBe('');

        const kept = events.reduce(
            (n, e) => n + (e.ev === 'response' ? e.bodyHead.length : 0),
            0,
        );
        expect(kept).toBeLessThanOrEqual(SESSION_BODY_BUDGET);
    });
});

describe('clipBody', () => {
    test('leaves a body that fits untouched', () => {
        expect(clipBody('short', 10)).toBe('short');
    });

    test('marks a truncation so a cut body is never read as a short one', () => {
        expect(clipBody('abcdefghij', 4)).toBe('abcd…[+6B]');
    });
});

describe('the report', () => {
    test('warns about the secrets it carries', () => {
        const trace = new DebugTrace(fakeClock().now);
        const report = trace.toReport() as { _comment: string };

        // The file holds signed URLs and pot tokens; the warning travels with it.
        expect(report._comment).toMatch(/do not paste into a public issue/i);
    });

    test('carries the sessions and the caller metadata', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'https://youtube.com/watch?v=abc');
        trace.push({ ev: 'verdict', kind: 'no-subtitles', failure: 'stale-url', trackCount: 0 });

        const report = trace.toReport({ version: '1.0.18' }) as {
            version: string;
            sessions: Array<{ videoId: string; events: unknown[] }>;
        };

        expect(report.version).toBe('1.0.18');
        expect(report.sessions).toHaveLength(1);
        expect(report.sessions[0].videoId).toBe('abc');
        expect(report.sessions[0].events).toHaveLength(1);
    });

    test('survives a round trip through JSON, which is how it is persisted', () => {
        const trace = new DebugTrace(fakeClock().now);
        trace.startSession('abc', 'u');
        trace.push({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x?pot=abc', potPresent: true });

        const revived = new DebugTrace(fakeClock().now);
        revived.load(JSON.parse(JSON.stringify(trace.all())));

        expect(revived.all()).toEqual(trace.all());
    });

    test('load() keeps only the newest sessions when handed more than the ring holds', () => {
        const trace = new DebugTrace(fakeClock().now);
        const many = Array.from({ length: MAX_SESSIONS + 2 }, (_, i) => ({
            videoId: `v${i}`,
            startedAt: 0,
            url: 'u',
            events: [],
            dropped: {},
        }));

        trace.load(many);

        expect(trace.all().map((s) => s.videoId)).toEqual(['v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    });
});
