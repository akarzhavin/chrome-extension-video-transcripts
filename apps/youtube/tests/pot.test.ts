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
    PotStore,
    SharedOnce,
    buildTimedTextUrl,
    isEmptyish,
    potFromResourceTiming,
    shouldRetryWithPot,
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
