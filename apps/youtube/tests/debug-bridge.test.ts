import {
    BATCH_FLUSH_MS,
    DEBUG_BATCH,
    DEBUG_STATE,
    isDebugBatch,
    isDebugState,
    MainTraceSink,
    PREARM_LIMIT,
    type DebugBatchMessage,
} from '../src/content/debug-bridge';

function harness(startNow = 10_000) {
    let now = startNow;
    const posted: DebugBatchMessage[] = [];
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const sink = new MainTraceSink({
        post: (m) => posted.push(m),
        now: () => now,
        setTimer: (fn) => {
            const id = nextId++;
            pending.set(id, fn);
            return id;
        },
        clearTimer: (id) => {
            pending.delete(id);
        },
    });
    return {
        sink,
        posted,
        advance: (ms: number) => {
            now += ms;
        },
        runTimers: () => {
            const fns = [...pending.values()];
            pending.clear();
            for (const fn of fns) fn();
        },
        timerCount: () => pending.size,
        allEvents: () => posted.flatMap((p) => p.events),
    };
}

describe('the cold-start window', () => {
    test('events recorded before the handshake are replayed once it arrives', () => {
        // page-script runs at document_start, the content script at
        // document_idle. On a fast navigation the MAIN world is already
        // fetching before it can possibly know whether to record — and that is
        // exactly the stretch where subtitle failures cluster.
        const h = harness();

        h.sink.record({ ev: 'player_response', source: 'player-api', trackCount: 2, polls: 3 });
        h.sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });
        expect(h.posted).toHaveLength(0); // nothing leaves before we know

        h.sink.setState(true, 10_000);
        h.runTimers();

        expect(h.allEvents().map((e) => e.ev)).toEqual(['player_response', 'attempt']);
    });

    test('the replayed events are re-stamped against the session epoch', () => {
        // Before the handshake there is no epoch to stamp against. Handing the
        // isolated world events stamped from zero would place them in 1970 and
        // sort the whole cold start to the front of every timeline.
        const h = harness(10_000);

        h.advance(200);
        h.sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });

        // The session actually opened at 10_000; the event happened 200ms in.
        h.sink.setState(true, 10_000);
        h.runTimers();

        expect(h.allEvents()[0].t).toBe(200);
    });

    test('the pre-arm buffer is bounded, and says how much it let go', () => {
        const h = harness();

        for (let i = 0; i < PREARM_LIMIT + 40; i++) {
            h.sink.record({ ev: 'attempt', key: 'k', attempt: i, url: 'https://x', potPresent: false });
        }
        h.sink.setState(true, 10_000);
        h.runTimers();

        expect(h.allEvents()).toHaveLength(PREARM_LIMIT);
        expect(h.sink.droppedBeforeArming()).toBe(40);
    });

    test('the buffer keeps the most RECENT window, not the first events it saw', () => {
        // A page that idles before the handshake should hand over what just
        // happened, not what happened a minute ago.
        const h = harness();

        for (let i = 0; i < PREARM_LIMIT + 5; i++) {
            h.sink.record({ ev: 'attempt', key: 'k', attempt: i, url: 'https://x', potPresent: false });
        }
        h.sink.setState(true, 10_000);
        h.runTimers();

        const attempts = h.allEvents().map((e) => (e as { attempt: number }).attempt);
        expect(attempts[attempts.length - 1]).toBe(PREARM_LIMIT + 4);
        expect(attempts[0]).toBe(5);
    });

    test('an answer of "off" discards the buffer and posts nothing', () => {
        const h = harness();
        h.sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });

        h.sink.setState(false, 10_000);
        h.runTimers();

        expect(h.posted).toHaveLength(0);
    });

    test('once told "off", later events are dropped without buffering', () => {
        const h = harness();
        h.sink.setState(false, 10_000);

        h.sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });
        h.runTimers();

        expect(h.posted).toHaveLength(0);
        expect(h.timerCount()).toBe(0);
    });
});

describe('batching', () => {
    test('many events in one tick cost one message, not one each', () => {
        // Every postMessage on `window` is work the page can also observe, and
        // the retry loop emits several events per millisecond.
        const h = harness();
        h.sink.setState(true, 10_000);

        for (let i = 0; i < 12; i++) {
            h.sink.record({ ev: 'attempt', key: 'k', attempt: i, url: 'https://x', potPresent: false });
        }
        h.runTimers();

        expect(h.posted).toHaveLength(1);
        expect(h.posted[0].events).toHaveLength(12);
    });

    test('the coalescing window is the documented one', () => {
        let scheduled = 0;
        const sink = new MainTraceSink({
            post: () => {},
            now: () => 0,
            setTimer: (_fn, ms) => {
                scheduled = ms;
                return 1;
            },
            clearTimer: () => {},
        });
        sink.setState(true, 0);
        sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false });

        expect(scheduled).toBe(BATCH_FLUSH_MS);
    });

    test('an explicit flush with nothing queued posts nothing', () => {
        const h = harness();
        h.sink.setState(true, 10_000);

        h.sink.flush();

        expect(h.posted).toHaveLength(0);
    });

    test('a post that throws loses the batch without breaking the page', () => {
        const sink = new MainTraceSink({
            post: () => {
                throw new Error('postMessage failed');
            },
            now: () => 0,
            setTimer: (fn) => {
                fn();
                return 1;
            },
            clearTimer: () => {},
        });
        sink.setState(true, 0);

        // Diagnostics must never be able to take a subtitle load down.
        expect(() =>
            sink.record({ ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false }),
        ).not.toThrow();
    });
});

describe('message guards', () => {
    test('a batch is recognised only with the right type and an events array', () => {
        expect(isDebugBatch({ type: DEBUG_BATCH, events: [] })).toBe(true);
        expect(isDebugBatch({ type: DEBUG_BATCH })).toBe(false);
        expect(isDebugBatch({ type: 'YT_VTT_RESULT', events: [] })).toBe(false);
        expect(isDebugBatch(null)).toBe(false);
        expect(isDebugBatch('LG_TRACE_BATCH')).toBe(false);
    });

    test('a state message needs a real boolean, not a truthy value', () => {
        expect(isDebugState({ type: DEBUG_STATE, on: true, startedAt: 0 })).toBe(true);
        expect(isDebugState({ type: DEBUG_STATE, on: 'yes', startedAt: 0 })).toBe(false);
        expect(isDebugState({ type: DEBUG_STATE })).toBe(false);
        expect(isDebugState(undefined)).toBe(false);
    });
});
