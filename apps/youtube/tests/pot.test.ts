/**
 * @jest-environment jsdom
 */
// The `pot` (PO token) rules. YouTube re-introduced the requirement on
// 2026-08-28: /api/timedtext answers a tokenless request with HTTP 200 and a
// ZERO-BYTE body, so subtitles silently stopped loading while every unit test
// stayed green — they mock fetch, and what changed was the live contract.
//
// The rule these tests exist to protect: NOTHING may block on the token. The
// previous implementation waited 15s for it and failed the track with 'no-pot'
// when the sniff missed, which is precisely how a missing optimisation turned
// into a total outage.

import {
    POT_WAIT_MS,
    POT_WAIT_POLL_MS,
    PotStore,
    awaitPot,
    SharedOnce,
    buildTimedTextUrl,
    isEmptyish,
    potFromResourceTiming,
    shouldRetryWithPot,
    worthRetryingWithToken,
} from '../src/content/pot';

const BASE = 'https://www.youtube.com/watch?v=abc';
const timedtext = (params: Record<string, string>) => {
    const u = new URL('https://www.youtube.com/api/timedtext');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
};

describe('PotStore.capture', () => {
    test('reads the token off a timedtext URL the page requested', () => {
        const s = new PotStore();
        expect(s.capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE)).toBe(true);
        expect(s.get('abc')).toBe('TOKEN1');
    });

    test('keeps the first token seen, so in-flight retries are not churned', () => {
        const s = new PotStore();
        s.capture(timedtext({ v: 'abc', pot: 'FIRST' }), BASE);
        expect(s.capture(timedtext({ v: 'abc', pot: 'SECOND' }), BASE)).toBe(false);
        expect(s.get('abc')).toBe('FIRST');
    });

    test('keeps tokens apart per video', () => {
        const s = new PotStore();
        s.capture(timedtext({ v: 'abc', pot: 'A' }), BASE);
        s.capture(timedtext({ v: 'xyz', pot: 'X' }), BASE);
        expect(s.get('abc')).toBe('A');
        expect(s.get('xyz')).toBe('X');
        expect(s.get('nope')).toBeNull();
    });

    test('ignores non-timedtext URLs and tokenless requests', () => {
        const s = new PotStore();
        expect(s.capture('https://www.youtube.com/api/stats?v=abc&pot=NOPE', BASE)).toBe(false);
        expect(s.capture(timedtext({ v: 'abc' }), BASE)).toBe(false);
        expect(s.get('abc')).toBeNull();
    });

    // The wrappers run on every fetch/XHR the page makes; one unparseable URL
    // must not throw inside somebody else's request.
    test('survives a URL it cannot parse', () => {
        const s = new PotStore();
        expect(s.capture('::::not a url::::')).toBe(false);
    });
});

/**
 * Surviving a reload — behaviour map §3.8.
 *
 * A token is minted once per video and then held in memory, which lasts exactly
 * as long as the MAIN-world script does. A page reload builds a fresh one, and
 * everything learned about the video is gone.
 *
 * That is not a rare path. Measured on a live trace (RkonDCcrZwo): the token
 * was captured and served four requests at t=1032763; 4.6 minutes later, same
 * tab and same video, every lookup missed and all six requests went out
 * tokenless — which on this endpoint means six guaranteed empty answers and a
 * "no subtitles" verdict on a video whose subtitles had loaded minutes earlier.
 *
 * Across four traces: 158 tokenless requests, 0 successes. A token that is
 * remembered is therefore not an optimisation, it is the difference between
 * loading and not loading.
 *
 * Scoped to the tab (sessionStorage), because that is the token's own lifetime:
 * it is signed for this session, and carrying a stale one into a new tab would
 * put a dead token on a request that could otherwise have minted a fresh one.
 */
describe('PotStore persistence across a reload', () => {
    /** sessionStorage stand-in, so a "reload" is just a second PotStore over the same data. */
    function memoryStorage(): Storage {
        const data = new Map<string, string>();
        return {
            get length() { return data.size; },
            clear: () => data.clear(),
            getItem: (k: string) => data.get(k) ?? null,
            key: (i: number) => [...data.keys()][i] ?? null,
            removeItem: (k: string) => { data.delete(k); },
            setItem: (k: string, v: string) => { data.set(k, v); },
        } as Storage;
    }

    test('a captured token is still there after a reload', () => {
        const storage = memoryStorage();
        const before = new PotStore(storage);
        before.capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE);

        // The reload: a brand-new store, as a fresh MAIN world would build.
        const after = new PotStore(storage);

        expect(after.get('abc')).toBe('TOKEN1');
    });

    test('a token remembered from resource timing also survives', () => {
        const storage = memoryStorage();
        new PotStore(storage).remember('abc', 'LATE');
        expect(new PotStore(storage).get('abc')).toBe('LATE');
    });

    test('a token for another video is not served', () => {
        const storage = memoryStorage();
        new PotStore(storage).capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE);
        expect(new PotStore(storage).get('other')).toBeNull();
    });

    // The in-memory map stays the fast path and the source of truth for
    // "have I seen this already"; storage only outlives the page.
    test('the first-token-wins rule still holds across a reload', () => {
        const storage = memoryStorage();
        new PotStore(storage).capture(timedtext({ v: 'abc', pot: 'FIRST' }), BASE);

        const after = new PotStore(storage);
        expect(after.capture(timedtext({ v: 'abc', pot: 'SECOND' }), BASE)).toBe(false);
        expect(after.get('abc')).toBe('FIRST');
    });

    /**
     * Storage is the one dependency here that can throw rather than fail: a
     * viewer with site data blocked, or a quota that is full, makes every call
     * raise. The token is an optimisation on top of an already-working request
     * path, so a store that cannot persist must still capture and serve from
     * memory — never take the page down with it.
     */
    test('a storage that throws on every call does not break capture', () => {
        const hostile = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
            removeItem: () => { throw new Error('denied'); },
            clear: () => { throw new Error('denied'); },
            key: () => { throw new Error('denied'); },
            length: 0,
        } as unknown as Storage;

        const s = new PotStore(hostile);
        expect(s.capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE)).toBe(true);
        expect(s.get('abc')).toBe('TOKEN1');
    });

    test('corrupt stored data is ignored, not thrown on', () => {
        const storage = memoryStorage();
        storage.setItem('lg.pot.v1', '{not json');
        expect(() => new PotStore(storage).get('abc')).not.toThrow();
        expect(new PotStore(storage).get('abc')).toBeNull();
    });

    test('with no storage at all it behaves exactly as before', () => {
        const s = new PotStore();
        expect(s.capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE)).toBe(true);
        expect(s.get('abc')).toBe('TOKEN1');
        expect(s.get('nope')).toBeNull();
    });
});

describe('potFromResourceTiming', () => {
    test('recovers a token our wrappers missed', () => {
        const entries = [
            { name: 'https://www.youtube.com/s/player.js' },
            { name: timedtext({ v: 'abc', pot: 'LATE' }) },
        ];
        expect(potFromResourceTiming('abc', entries)).toBe('LATE');
    });

    test('does not hand back another video’s token', () => {
        const entries = [{ name: timedtext({ v: 'other', pot: 'NOTMINE' }) }];
        expect(potFromResourceTiming('abc', entries)).toBeNull();
    });

    test('skips unparseable entries instead of giving up', () => {
        const entries = [
            { name: 'garbage' },
            { name: timedtext({ v: 'abc', pot: 'FOUND' }) },
        ];
        expect(potFromResourceTiming('abc', entries)).toBe('FOUND');
    });
});

describe('buildTimedTextUrl', () => {
    test('always requests json3 from the WEB client', () => {
        const u = new URL(buildTimedTextUrl('/api/timedtext?v=abc', { base: BASE }));
        expect(u.searchParams.get('fmt')).toBe('json3');
        expect(u.searchParams.get('c')).toBe('WEB');
    });

    // The whole point of not blocking: a caller with no token still sends a
    // well-formed request rather than no request at all.
    test('omits pot entirely when there is none', () => {
        const u = new URL(buildTimedTextUrl('/api/timedtext?v=abc', { base: BASE }));
        expect(u.searchParams.has('pot')).toBe(false);
    });

    test('adds pot and tlang when given', () => {
        const u = new URL(buildTimedTextUrl('/api/timedtext?v=abc', {
            base: BASE, pot: 'TOKEN', tlang: 'ru',
        }));
        expect(u.searchParams.get('pot')).toBe('TOKEN');
        expect(u.searchParams.get('tlang')).toBe('ru');
    });

    test('preserves the signature params the baseUrl carries', () => {
        const signed = '/api/timedtext?v=abc&signature=SIG&expire=123&lang=en';
        const u = new URL(buildTimedTextUrl(signed, { base: BASE, pot: 'T' }));
        expect(u.searchParams.get('signature')).toBe('SIG');
        expect(u.searchParams.get('expire')).toBe('123');
        expect(u.searchParams.get('lang')).toBe('en');
    });
});

describe('isEmptyish', () => {
    // An empty 200 is reported as 'stale-url' because the response alone cannot
    // distinguish a dead link from a missing token.
    test.each(['stale-url', 'not-offered'])('%s is the served-nothing shape', (f) => {
        expect(isEmptyish(f)).toBe(true);
    });

    test.each(['rate-limited', 'network', 'aborted', 'unavailable', undefined])(
        '%s is not', (f) => {
            expect(isEmptyish(f as string | undefined)).toBe(false);
        },
    );
});

describe('shouldRetryWithPot', () => {
    test('retries when a token arrived after the request went out', () => {
        expect(shouldRetryWithPot('stale-url', null, 'TOKEN')).toBe(true);
    });

    // Without this guard the retry re-sends an identical request and launders
    // the same empty answer into a second attempt.
    test('does not retry when the token is unchanged', () => {
        expect(shouldRetryWithPot('stale-url', 'TOKEN', 'TOKEN')).toBe(false);
    });

    test('does not retry when no token turned up', () => {
        expect(shouldRetryWithPot('stale-url', null, null)).toBe(false);
    });

    // Throttling is not a token problem; re-sending would feed the limit.
    test('does not retry a rate-limited answer', () => {
        expect(shouldRetryWithPot('rate-limited', null, 'TOKEN')).toBe(false);
    });

    test('does not retry a request the user navigated away from', () => {
        expect(shouldRetryWithPot('aborted', null, 'TOKEN')).toBe(false);
    });
});

describe('SharedOnce', () => {
    const deferred = <T,>() => {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((r) => { resolve = r; });
        return { promise, resolve };
    };

    // The parallel-tracks bug: every track that comes back empty must end up
    // with the token the single toggle produces, not just whichever one got
    // there first.
    test('concurrent callers all receive the one result', async () => {
        const s = new SharedOnce<string | null>();
        const d = deferred<string | null>();
        let runs = 0;
        const task = () => { runs++; return d.promise; };

        const a = s.run('vid', task, () => null);
        const b = s.run('vid', task, () => null);
        const c = s.run('vid', task, () => null);

        d.resolve('TOKEN');
        expect(await a).toBe('TOKEN');
        expect(await b).toBe('TOKEN');
        expect(await c).toBe('TOKEN');
        expect(runs).toBe(1);
    });

    test('a completed key does not run the task again', async () => {
        const s = new SharedOnce<string | null>();
        let runs = 0;
        await s.run('vid', () => { runs++; return Promise.resolve('T'); }, () => null);
        s.complete('vid');

        expect(await s.run('vid', () => { runs++; return Promise.resolve('T2'); }, () => 'CACHED'))
            .toBe('CACHED');
        expect(runs).toBe(1);
    });

    // A key is only "done" once something marks it so — an attempt that bailed
    // before doing any work (no CC button rendered yet) must stay retryable.
    test('an unmarked key is retried', async () => {
        const s = new SharedOnce<string | null>();
        let runs = 0;
        const task = () => { runs++; return Promise.resolve(null); };

        await s.run('vid', task, () => null);
        await s.run('vid', task, () => null);
        expect(runs).toBe(2);
        expect(s.hasCompleted('vid')).toBe(false);
    });

    test('keys are independent', async () => {
        const s = new SharedOnce<string | null>();
        let runs = 0;
        const task = () => { runs++; return Promise.resolve('T'); };
        await Promise.all([s.run('a', task, () => null), s.run('b', task, () => null)]);
        expect(runs).toBe(2);
    });
});

/**
 * Waiting for a token before spending a request — behaviour map §3.9.
 *
 * The measurement that motivates this, across four live traces (202 requests):
 *
 *     with a token   :  44 requests ->  39 loaded (89%)
 *     without a token: 158 requests ->   0 loaded (0%)
 *
 * A tokenless request to /api/timedtext is not a request with poor odds; it is
 * a request with none. Sending one and then going to look for the token spends
 * a guaranteed failure to learn something we already know, and — because the
 * empty answer is retried — spends it up to three times per track. All 24 of
 * the 429s in those traces landed on tokenless requests.
 *
 * So: give the token a brief chance to arrive first. The ceiling is what keeps
 * this from becoming the outage of 9cf1f39, where a 15-second block plus a
 * 'no-pot' verdict meant a missed sniff stopped subtitles entirely. Here the
 * wait is short, and when it expires the request goes out anyway with whatever
 * is known — exactly today's behaviour, demoted from the rule to the fallback.
 */
describe('awaitPot', () => {
    /** A clock and a sleep that advance only when the test says so. */
    function fakeClock() {
        let t = 0;
        const sleep = jest.fn(async (ms: number) => { t += ms; });
        return { now: () => t, sleep, elapsed: () => t };
    }

    test('a token already in hand costs no waiting at all', async () => {
        const c = fakeClock();
        const got = await awaitPot(() => 'HAVE', { now: c.now, sleep: c.sleep });
        expect(got).toBe('HAVE');
        expect(c.sleep).not.toHaveBeenCalled();
        expect(c.elapsed()).toBe(0);
    });

    test('a token that arrives during the wait is picked up', async () => {
        const c = fakeClock();
        let token: string | null = null;
        // Arrives on the third look.
        let looks = 0;
        const got = await awaitPot(
            () => { if (++looks >= 3) token = 'LATE'; return token; },
            { now: c.now, sleep: c.sleep },
        );
        expect(got).toBe('LATE');
        expect(c.elapsed()).toBeLessThan(POT_WAIT_MS);
    });

    /**
     * The whole safety argument. When no token ever appears the caller must get
     * null and carry on — never an exception, never an unbounded wait.
     */
    test('gives up at the ceiling and reports no token', async () => {
        const c = fakeClock();
        const got = await awaitPot(() => null, { now: c.now, sleep: c.sleep });
        expect(got).toBeNull();
        expect(c.elapsed()).toBeGreaterThanOrEqual(POT_WAIT_MS);
    });

    /**
     * That the loop TERMINATES, asserted without relying on it terminating.
     *
     * Written this way because the obvious version does not work: the fake
     * clock only advances inside sleep(), so a loop with no ceiling spins
     * forever and the test hangs until the runner kills the whole file —
     * reporting nothing at all rather than a failure. Verified by mutation
     * (replacing the bound with `while (true)` produced an empty test run).
     *
     * So the sleep itself refuses to be called more times than a bounded loop
     * ever could, which turns "runs forever" into a plain assertion failure.
     */
    test('the wait is bounded — the loop cannot spin past the ceiling', async () => {
        const maxPolls = Math.ceil(POT_WAIT_MS / POT_WAIT_POLL_MS);
        let polls = 0;
        let t = 0;
        const sleep = jest.fn(async (ms: number) => {
            if (++polls > maxPolls + 1) throw new Error(`unbounded: slept ${polls} times`);
            t += ms;
        });

        await expect(awaitPot(() => null, { now: () => t, sleep })).resolves.toBeNull();

        expect(polls).toBeLessThanOrEqual(maxPolls + 1);
        // One poll interval of overshoot is the most the loop can add.
        expect(t).toBeLessThanOrEqual(POT_WAIT_MS + POT_WAIT_POLL_MS);
    });

    test('an abort ends the wait immediately', async () => {
        const c = fakeClock();
        const ctl = new AbortController();
        ctl.abort();
        const got = await awaitPot(() => null, { now: c.now, sleep: c.sleep, signal: ctl.signal });
        expect(got).toBeNull();
        expect(c.sleep).not.toHaveBeenCalled();
    });

    test('an abort DURING the wait ends it', async () => {
        const c = fakeClock();
        const ctl = new AbortController();
        let looks = 0;
        await awaitPot(
            () => { if (++looks === 2) ctl.abort(); return null; },
            { now: c.now, sleep: c.sleep, signal: ctl.signal },
        );
        expect(c.elapsed()).toBeLessThan(POT_WAIT_MS);
    });

    // The ceiling is a promise to the viewer: a video whose token never comes
    // still loads (or fails) promptly, rather than hanging.
    test('the ceiling is short enough not to be felt as a hang', () => {
        expect(POT_WAIT_MS).toBeLessThanOrEqual(1500);
    });
});

/**
 * A token that arrives late must still be usable — behaviour map §3.11.
 *
 * Measured across the live traces, this is what the remaining 46% of failed
 * mints actually are. The shape is always the same:
 *
 *     4015ms, 4012ms, 0ms, 0ms     <- both tracks time out, then every
 *                                     later attempt is refused instantly
 *
 * Two tracks mint concurrently and each burns the full POT_TOGGLE_TIMEOUT_MS;
 * `once.complete()` has claimed the video, so every attempt after that returns
 * immediately without clicking. Then:
 *
 *     t=272399  mint_done  present=false   <- we stopped listening
 *     t=346201  sniffed    present=true    <- the token arrived anyway
 *
 * The token was not unobtainable — it came 73 seconds later, and in another
 * session 5.2 seconds later. The sessions where it "never arrived" simply ended
 * ~1.6s after we gave up. So the failure is not that minting does not work; it
 * is that nothing is watching by the time it pays off.
 *
 * Hence a subscription: whoever captures a token announces it, and a track that
 * already failed can act on it instead of the token landing in a store nobody
 * reads again. This costs no requests — it is a callback on an event that
 * happens anyway.
 */
describe('PotStore notifies when a token arrives', () => {
    test('a subscriber is told about a captured token', () => {
        const s = new PotStore();
        const seen: Array<{ videoId: string; pot: string }> = [];
        s.onToken((videoId, pot) => seen.push({ videoId, pot }));

        s.capture(timedtext({ v: 'abc', pot: 'TOKEN1' }), BASE);

        expect(seen).toEqual([{ videoId: 'abc', pot: 'TOKEN1' }]);
    });

    test('a token recovered by other means also notifies', () => {
        const s = new PotStore();
        const seen: string[] = [];
        s.onToken((_v, pot) => seen.push(pot));

        s.remember('abc', 'LATE');

        expect(seen).toEqual(['LATE']);
    });

    // First-token-wins already refuses the second capture; it must not announce
    // one either, or a subscriber would act twice on the same news.
    test('a repeat capture announces nothing', () => {
        const s = new PotStore();
        const seen: string[] = [];
        s.capture(timedtext({ v: 'abc', pot: 'FIRST' }), BASE);
        s.onToken((_v, pot) => seen.push(pot));

        s.capture(timedtext({ v: 'abc', pot: 'SECOND' }), BASE);

        expect(seen).toEqual([]);
    });

    test('every subscriber hears it', () => {
        const s = new PotStore();
        const a: string[] = [];
        const b: string[] = [];
        s.onToken((_v, p) => a.push(p));
        s.onToken((_v, p) => b.push(p));

        s.capture(timedtext({ v: 'abc', pot: 'T' }), BASE);

        expect(a).toEqual(['T']);
        expect(b).toEqual(['T']);
    });

    /**
     * A subscriber that throws must not stop the capture or the other
     * subscribers: this runs inside the page's own fetch/XHR wrapper, where an
     * exception would surface in YouTube's code, not ours.
     */
    test('a throwing subscriber breaks neither the capture nor its neighbours', () => {
        const s = new PotStore();
        const other: string[] = [];
        s.onToken(() => { throw new Error('boom'); });
        s.onToken((_v, p) => other.push(p));

        expect(() => s.capture(timedtext({ v: 'abc', pot: 'T' }), BASE)).not.toThrow();
        expect(s.get('abc')).toBe('T');
        expect(other).toEqual(['T']);
    });

    test('unsubscribing stops the notifications', () => {
        const s = new PotStore();
        const seen: string[] = [];
        const off = s.onToken((_v, p) => seen.push(p));

        off();
        s.capture(timedtext({ v: 'abc', pot: 'T' }), BASE);

        expect(seen).toEqual([]);
    });
});

/**
 * Which failures a late token could still fix — behaviour map §3.12.
 *
 * `isEmptyish` answers a different question ("is this the shape of a missing
 * token"), and the pot cascade depends on it staying that narrow. This one asks
 * whether a LATE token is worth a refetch, and the answer is broader: on this
 * endpoint a tokenless request cannot succeed whatever the status line said, so
 * a 429 that went out bare is exactly as doomed as an empty 200 — and just as
 * fixable once a token exists.
 *
 * Measured across the traces: 14 failed tokenless rounds ended 'stale-url' and
 * 2 ended 'rate-limited'; a token arrived later in 4 and 1 of them respectively.
 * The rate-limited one was getting no rescue at all.
 */
describe('worthRetryingWithToken', () => {
    test('the empty-200 shapes are worth a refetch', () => {
        expect(worthRetryingWithToken('stale-url')).toBe(true);
        expect(worthRetryingWithToken('not-offered')).toBe(true);
    });

    // The hole this closes: a bare request that met a throttle is still a bare
    // request, and a token is still what it was missing.
    test('a throttled round is worth a refetch too', () => {
        expect(worthRetryingWithToken('rate-limited')).toBe(true);
        expect(worthRetryingWithToken('cooldown')).toBe(true);
    });

    // Outcomes a token cannot change: the user left, or the track is gone.
    test('outcomes a token cannot fix are not retried', () => {
        expect(worthRetryingWithToken('aborted')).toBe(false);
        expect(worthRetryingWithToken('unavailable')).toBe(false);
    });

    test('an absent failure is not a reason to refetch', () => {
        expect(worthRetryingWithToken(undefined)).toBe(false);
    });

    // isEmptyish must stay narrow: the pot cascade uses it to decide whether to
    // flash the viewer's captions, and a 429 is not a reason to do that.
    test('isEmptyish is left alone — the two ask different questions', () => {
        expect(isEmptyish('rate-limited')).toBe(false);
        expect(isEmptyish('stale-url')).toBe(true);
    });
});
