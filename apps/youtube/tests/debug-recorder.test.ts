import {
    FLUSH_DEBOUNCE_MS,
    MAX_TOTAL_BYTES,
    TRACE_KEY,
    TraceRecorder,
    type StorageLike,
} from '../src/content/debug-recorder';
import type { StampedEvent, TraceSession } from '../src/content/debug-trace';

/**
 * A storage double that records what it was asked to do and can be made to fail
 * the way chrome.storage fails: by rejecting.
 */
function fakeStorage(): StorageLike & {
    sets: Array<Record<string, unknown>>;
    data: Record<string, unknown>;
    failNextSet: (reason?: string) => void;
    removed: string[];
} {
    const data: Record<string, unknown> = {};
    const sets: Array<Record<string, unknown>> = [];
    const removed: string[] = [];
    let failOnce: string | null = null;
    return {
        data,
        sets,
        removed,
        failNextSet(reason = 'QUOTA_BYTES quota exceeded') {
            failOnce = reason;
        },
        async get(key) {
            return { [key]: data[key] };
        },
        async set(items) {
            if (failOnce) {
                const reason = failOnce;
                failOnce = null;
                throw new Error(reason);
            }
            sets.push(items);
            Object.assign(data, items);
        },
        async remove(key) {
            removed.push(key);
            delete data[key];
        },
    };
}

/** A hand-driven timer, so the debounce is asserted without waiting on real time. */
function fakeTimers() {
    let next = 1;
    const pending = new Map<number, () => void>();
    return {
        setTimer: (fn: () => void) => {
            const id = next++;
            pending.set(id, fn);
            return id;
        },
        clearTimer: (id: number) => {
            pending.delete(id);
        },
        /** Fire everything currently scheduled. */
        run: () => {
            const fns = [...pending.values()];
            pending.clear();
            for (const fn of fns) fn();
        },
        count: () => pending.size,
    };
}

function makeRecorder(storage = fakeStorage(), timers = fakeTimers()) {
    const recorder = new TraceRecorder({
        storage,
        now: () => 1_000_000,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });
    recorder.setEnabled(true);
    return { recorder, storage, timers };
}

describe('the toggle gates recording, not the buffer', () => {
    test('records nothing while disabled', () => {
        const { recorder } = makeRecorder();
        recorder.setEnabled(false);

        recorder.startSession('abc', 'u');
        recorder.record({ ev: 'no_captions', videoId: 'abc' });

        expect(recorder.sessions()).toHaveLength(0);
    });

    test('turning it off keeps what was already recorded', () => {
        // The user turns the recorder off and then goes to read the report.
        // Discarding the buffer at that moment would destroy the evidence they
        // turned it off in order to look at.
        const { recorder } = makeRecorder();
        recorder.startSession('abc', 'u');
        recorder.record({ ev: 'no_captions', videoId: 'abc' });

        recorder.setEnabled(false);

        expect(recorder.sessions()).toHaveLength(1);
        expect(recorder.sessions()[0].events).toHaveLength(1);
    });

    test('only an explicit clear discards it', async () => {
        const { recorder, storage } = makeRecorder();
        recorder.startSession('abc', 'u');
        recorder.record({ ev: 'no_captions', videoId: 'abc' });

        await recorder.clear();

        expect(recorder.sessions()).toHaveLength(0);
        expect(storage.removed).toEqual([TRACE_KEY]);
    });
});

describe('writes are debounced', () => {
    test('a burst of events costs one write, not one per event', async () => {
        const { recorder, storage, timers } = makeRecorder();
        recorder.startSession('abc', 'u');

        for (let i = 0; i < 50; i++) {
            recorder.record({ ev: 'attempt', key: 'k', attempt: i, url: 'https://x', potPresent: false });
        }
        expect(storage.sets).toHaveLength(0); // nothing yet — still coalescing

        timers.run();
        await Promise.resolve();

        expect(storage.sets).toHaveLength(1);
    });

    test('the debounce window is the documented one', () => {
        const storage = fakeStorage();
        const scheduled: number[] = [];
        const recorder = new TraceRecorder({
            storage,
            setTimer: (_fn, ms) => {
                scheduled.push(ms);
                return 1;
            },
            clearTimer: () => {},
        });
        recorder.setEnabled(true);
        recorder.startSession('abc', 'u');

        expect(scheduled[0]).toBe(FLUSH_DEBOUNCE_MS);
    });

    test('a verdict is written immediately, because the tab may not survive it', async () => {
        const { recorder, storage } = makeRecorder();
        recorder.startSession('abc', 'u');

        recorder.record({ ev: 'verdict', kind: 'no-subtitles', failure: 'stale-url', trackCount: 0 });
        await Promise.resolve();
        await Promise.resolve();

        // No timer had to fire: the write already happened.
        expect(storage.sets).toHaveLength(1);
    });
});

describe('persistence across a reload', () => {
    test('hydrate restores the sessions a previous page wrote', async () => {
        const storage = fakeStorage();
        const previous: TraceSession[] = [
            {
                videoId: 'earlier',
                startedAt: 5,
                url: 'https://youtube.com/watch?v=earlier',
                events: [{ ev: 'no_captions', videoId: 'earlier', t: 0, w: 'iso' } as StampedEvent],
                dropped: {},
            },
        ];
        storage.data[TRACE_KEY] = previous;

        const { recorder } = makeRecorder(storage);
        await recorder.hydrate();

        // This is the entire point of persisting: the failure is noticed after
        // the reload that was the user's first instinct for fixing it.
        expect(recorder.sessions()).toHaveLength(1);
        expect(recorder.sessions()[0].videoId).toBe('earlier');
    });

    test('a corrupt stored buffer starts fresh instead of breaking boot', async () => {
        const storage = fakeStorage();
        storage.data[TRACE_KEY] = { not: 'an array' };

        const { recorder } = makeRecorder(storage);
        await expect(recorder.hydrate()).resolves.toBeUndefined();
        expect(recorder.sessions()).toHaveLength(0);
    });

    test('a storage that rejects on read does not break boot either', async () => {
        const storage = fakeStorage();
        storage.get = async () => {
            throw new Error('Extension context invalidated');
        };

        const { recorder } = makeRecorder(storage);
        await expect(recorder.hydrate()).resolves.toBeUndefined();
    });
});

describe('the storage budget', () => {
    test('the per-session body budget is the first line of defence, before storage', async () => {
        // Bodies are the only unbounded field, and DebugTrace surrenders them
        // as they arrive — so a video answering with megabyte bodies never
        // reaches the storage budget at all. Pinned because it explains why the
        // shedding loop below is a BACKSTOP and not the everyday path: someone
        // reading only that loop would think bodies are what it defends against.
        const { recorder } = makeRecorder();
        const huge = 'x'.repeat(MAX_TOTAL_BYTES);

        recorder.startSession('abc', 'u');
        recorder.record({
            ev: 'response',
            key: 'k',
            attempt: 1,
            status: 200,
            bytes: huge.length,
            headers: {},
            bodyHead: huge,
        });

        await recorder.flush();

        expect(JSON.stringify(recorder.sessions()).length).toBeLessThan(MAX_TOTAL_BYTES);
    });

    test('a buffer that still will not fit sheds its oldest sessions rather than failing the write', async () => {
        const { recorder, storage } = makeRecorder();

        // Reach past the body budget by volume of EVENTS rather than body size:
        // urls are not blanked, so many long ones do add up. Three sessions,
        // each fat enough that all three cannot be stored together.
        const longUrl = 'https://youtube.com/api/timedtext?sig=' + 'y'.repeat(4000);
        for (const id of ['first', 'second', 'third']) {
            recorder.startSession(id, `https://youtube.com/watch?v=${id}`);
            for (let i = 0; i < 200; i++) {
                recorder.record({ ev: 'attempt', key: 'k', attempt: i, url: longUrl, potPresent: false });
            }
        }
        expect(JSON.stringify(recorder.sessions()).length).toBeGreaterThan(MAX_TOTAL_BYTES);

        await recorder.flush();

        expect(storage.sets).toHaveLength(1);
        const written = storage.sets[0][TRACE_KEY] as TraceSession[];
        // The newest video is the one being debugged, so it is the one kept.
        expect(written[written.length - 1].videoId).toBe('third');
        expect(written.length).toBeLessThan(3);
        expect(JSON.stringify(written).length).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    });

    test('a quota rejection is counted and surfaced, not swallowed', async () => {
        const { recorder, storage } = makeRecorder();
        recorder.startSession('abc', 'u');
        storage.failNextSet();

        await recorder.flush();

        // The buffer is still readable in memory — the feature degrades to
        // "this session only" rather than failing.
        expect(recorder.sessions()).toHaveLength(1);
        const report = recorder.report() as { quotaFailures?: number };
        expect(report.quotaFailures).toBe(1);
    });

    test('a healthy run reports no quota trouble at all', async () => {
        const { recorder } = makeRecorder();
        recorder.startSession('abc', 'u');

        await recorder.flush();

        // Absence matters: a field that were always present would train the
        // reader to ignore it, and then it would be ignored when it means
        // something. See the "alarm on the happy path" rule.
        expect(recorder.report()).not.toHaveProperty('quotaFailures');
    });
});

describe('events from the MAIN world', () => {
    test('are merged into the open session', () => {
        const { recorder } = makeRecorder();
        recorder.startSession('abc', 'u');

        recorder.ingestFromMain([
            { ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false, t: 10, w: 'main' },
        ] as StampedEvent[]);

        expect(recorder.sessions()[0].events).toHaveLength(1);
        expect(recorder.sessions()[0].events[0].w).toBe('main');
    });

    test('an empty batch is not a reason to schedule a write', () => {
        const { recorder, timers } = makeRecorder();
        recorder.startSession('abc', 'u');
        timers.run(); // drain the session's own flush

        recorder.ingestFromMain([]);

        expect(timers.count()).toBe(0);
    });

    test('are dropped while the recorder is off', () => {
        const { recorder } = makeRecorder();
        recorder.startSession('abc', 'u');
        recorder.setEnabled(false);

        recorder.ingestFromMain([
            { ev: 'attempt', key: 'k', attempt: 1, url: 'https://x', potPresent: false, t: 10, w: 'main' },
        ] as StampedEvent[]);

        expect(recorder.sessions()[0].events).toHaveLength(0);
    });
});

describe('the session epoch the MAIN world stamps against', () => {
    test('is the open session start, so both worlds share one timeline', () => {
        const { recorder } = makeRecorder();
        recorder.startSession('abc', 'u');

        expect(recorder.sessionStartedAt()).toBe(recorder.sessions()[0].startedAt);
    });

    test('falls back to now when no session is open, rather than to zero', () => {
        // Zero would stamp every pre-session MAIN event with a t of ~1.7e12,
        // which sorts them after everything and reads as the far future.
        const { recorder } = makeRecorder();
        expect(recorder.sessionStartedAt()).toBe(1_000_000);
    });

    /**
     * Opening a session tells whoever has to relay the epoch.
     *
     * The MAIN world learns the epoch only when the isolated world posts it,
     * and sessions open from four places — hydrate, the prefs toggle, and two
     * navigation paths in index.ts that have no reference to the announcement
     * at all. The hook is what makes the epoch a property of opening a session
     * rather than something each call site has to remember.
     */
    describe('opening a session notifies the epoch relay', () => {
        function withHook(clock: () => number) {
            const starts: number[] = [];
            const timers = fakeTimers();
            const recorder = new TraceRecorder({
                storage: fakeStorage(),
                now: clock,
                setTimer: timers.setTimer,
                clearTimer: timers.clearTimer,
                onSessionStart: () => starts.push(recorder.sessionStartedAt()),
            });
            recorder.setEnabled(true);
            return { recorder, starts };
        }

        test('a new video fires it with that video’s epoch', () => {
            let t = 1_000_000;
            const { recorder, starts } = withHook(() => t);

            recorder.startSession('first', 'u1');
            t += 30_000;
            recorder.startSession('second', 'u2');

            // Both epochs, in order — and the second is the NEW session's
            // start, not the one the MAIN world was still stamping against.
            expect(starts).toEqual([1_000_000, 1_030_000]);
            expect(starts[1]).toBe(recorder.sessions()[1].startedAt);
        });

        test('re-opening the same video does not fire it, because the epoch did not move', () => {
            let t = 1_000_000;
            const { recorder, starts } = withHook(() => t);

            recorder.startSession('same', 'u');
            t += 5_000;
            recorder.startSession('same', 'u'); // a "Search again", not a navigation

            expect(starts).toEqual([1_000_000]);
        });

        test('it does not fire while the recorder is off, because no session opened', () => {
            const { recorder, starts } = withHook(() => 1_000_000);
            recorder.setEnabled(false);

            recorder.startSession('abc', 'u');

            expect(starts).toEqual([]);
        });
    });
});
