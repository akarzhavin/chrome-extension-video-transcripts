/**
 * Refetching a track when its token turns up late — behaviour map §3.11.
 *
 * The measurement behind this, from four live traces: a tokenless timedtext
 * request returned subtitles 0 times out of 158, and 46% of mints time out
 * without producing a token. But the token is not unobtainable — it arrives
 * after we have stopped listening:
 *
 *     t=272399  mint_done  present=false   <- gave up
 *     t=346201  sniffed    present=true    <- arrived anyway (+73.8s)
 *
 * Another session: +5.2s. The ones where it "never" arrived simply ended ~1.6s
 * after the mint gave up. So the fix is to be told rather than to keep asking.
 *
 * These tests pin the bounds that stop a rescue becoming a leak or a burst.
 */
import { LateTokenRescue, type RescueDeps } from '../src/content/late-token-rescue';

/** A stand-in for PotStore's subscription, driven by hand. */
function tokenSource() {
    const listeners = new Set<(videoId: string, pot: string) => void>();
    return {
        onToken: (fn: (videoId: string, pot: string) => void) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** The page captures a token, as the XHR sniffer would. */
        arrives: (videoId: string, pot = 'TOKEN') => {
            for (const fn of [...listeners]) fn(videoId, pot);
        },
        count: () => listeners.size,
    };
}

function harness(over: Partial<RescueDeps> = {}) {
    const src = tokenSource();
    const refetched: string[] = [];
    const rescue = new LateTokenRescue({
        onToken: src.onToken,
        refetch: (k) => refetched.push(k),
        ...over,
    });
    return { rescue, src, refetched };
}

const live = () => new AbortController();

describe('LateTokenRescue', () => {
    test('a token that arrives after the failure refetches the track', () => {
        const h = harness();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });

        h.src.arrives('vid');

        expect(h.refetched).toEqual(['vid:English']);
    });

    test('nothing is refetched until a token actually arrives', () => {
        const h = harness();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });

        // The whole cost argument: arming spends no request.
        expect(h.refetched).toEqual([]);
    });

    test('a token for another video is ignored', () => {
        const h = harness();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });

        h.src.arrives('some-other-video');

        expect(h.refetched).toEqual([]);
    });

    test('both tracks of a video are rescued', () => {
        const h = harness();
        const signal = live().signal;
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal });
        h.rescue.arm({ reqKey: 'vid:Russian', videoId: 'vid', signal });

        h.src.arrives('vid');

        expect(h.refetched.sort()).toEqual(['vid:English', 'vid:Russian']);
    });

    /**
     * The bound that keeps this from becoming the retry burst it replaces: a
     * token announced twice must not produce two refetches.
     */
    test('it fires at most once per arming', () => {
        const h = harness();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });

        h.src.arrives('vid');
        h.src.arrives('vid');
        h.src.arrives('vid');

        expect(h.refetched).toEqual(['vid:English']);
    });

    test('arming the same track twice adds only one wait', () => {
        const h = harness();
        const signal = live().signal;
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal });
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal });

        expect(h.rescue.size).toBe(1);
        h.src.arrives('vid');
        expect(h.refetched).toEqual(['vid:English']);
    });

    // No listener may outlive the thing it is waiting for.
    test('firing removes the subscription', () => {
        const h = harness();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });
        expect(h.src.count()).toBe(1);

        h.src.arrives('vid');

        expect(h.src.count()).toBe(0);
        expect(h.rescue.size).toBe(0);
    });

    /**
     * A navigation must release the subscription AT THE ABORT, not merely
     * decline to act on it later.
     *
     * Asserted on the state immediately after abort and before any token
     * arrives — a mutation proved the difference: dropping the abort listener
     * entirely still passed a version of this test that only checked the
     * outcome, because the in-listener `signal.aborted` guard cleaned up on the
     * way past. That leaves one dead subscription per abandoned track for as
     * long as the page lives.
     */
    test('a navigation releases the subscription immediately', () => {
        const h = harness();
        const ctl = live();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });
        expect(h.src.count()).toBe(1);

        ctl.abort();

        // Before any token arrives: nothing is left listening.
        expect(h.src.count()).toBe(0);
        expect(h.rescue.size).toBe(0);
    });

    test('a token after a navigation refetches nothing', () => {
        const h = harness();
        const ctl = live();
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });

        ctl.abort();
        h.src.arrives('vid');

        expect(h.refetched).toEqual([]);
    });

    test('arming on an already-aborted navigation does nothing', () => {
        const h = harness();
        const ctl = live();
        ctl.abort();

        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });

        expect(h.rescue.size).toBe(0);
        expect(h.src.count()).toBe(0);
    });

    /**
     * The refetch can fail the same way and arm a fresh rescue. That must be a
     * deliberate second arming, not a leftover listener — otherwise one track
     * would accumulate subscriptions and a later token would refetch it twice.
     */
    test('a refetch that re-arms leaves exactly one wait, not two', () => {
        const src = tokenSource();
        const refetched: string[] = [];
        const rescue: LateTokenRescue = new LateTokenRescue({
            onToken: src.onToken,
            refetch: (k) => {
                refetched.push(k);
                // Failed again, still tokenless: arm once more.
                rescue.arm({ reqKey: k, videoId: 'vid', signal: ctl.signal });
            },
        });
        const ctl = live();
        rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });

        src.arrives('vid');

        expect(refetched).toEqual(['vid:English']);
        expect(rescue.size).toBe(1);
        expect(src.count()).toBe(1);
    });

    test('clear() drops every wait and its subscription', () => {
        const h = harness();
        const signal = live().signal;
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal });
        h.rescue.arm({ reqKey: 'vid:Russian', videoId: 'vid', signal });

        h.rescue.clear();

        expect(h.rescue.size).toBe(0);
        expect(h.src.count()).toBe(0);
        h.src.arrives('vid');
        expect(h.refetched).toEqual([]);
    });

    test('the rescue is reported for the trace', () => {
        const seen: string[] = [];
        const h = harness({ onRescue: (k) => seen.push(k) });
        h.rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: live().signal });

        h.src.arrives('vid');

        expect(seen).toEqual(['vid:English']);
    });
});

/**
 * The bound that makes the rescue safe to arm on ANY token-fixable failure.
 *
 * Widening the arming rule to include throttled rounds raises an obvious
 * worry: a rescue that refetches, fails again, re-arms, and refetches again is
 * exactly the retry burst this whole effort exists to remove.
 *
 * It cannot happen, and the reason is structural rather than a counter:
 * PotStore is first-token-wins, so a video announces a token AT MOST ONCE.
 * A re-armed rescue is therefore waiting for an event that will not repeat —
 * it costs one dormant subscription, never a second request.
 */
describe('a rescue cannot loop', () => {
    test('a re-armed rescue is not fired again by the same token', () => {
        const src = tokenSource();
        const refetched: string[] = [];
        const ctl = new AbortController();
        const rescue: LateTokenRescue = new LateTokenRescue({
            onToken: src.onToken,
            refetch: (k) => {
                refetched.push(k);
                // The refetch failed again — arm once more, as the page does.
                rescue.arm({ reqKey: k, videoId: 'vid', signal: ctl.signal });
            },
        });
        rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });

        // The ONE announcement a first-token-wins store can make.
        src.arrives('vid');

        expect(refetched).toEqual(['vid:English']);
    });

    /**
     * And even if a store somehow announced twice, the refetch count is bounded
     * by the number of announcements — one per event, never a burst per event.
     */
    test('two announcements produce two refetches, not a burst', () => {
        const src = tokenSource();
        const refetched: string[] = [];
        const ctl = new AbortController();
        const rescue: LateTokenRescue = new LateTokenRescue({
            onToken: src.onToken,
            refetch: (k) => {
                refetched.push(k);
                rescue.arm({ reqKey: k, videoId: 'vid', signal: ctl.signal });
            },
        });
        rescue.arm({ reqKey: 'vid:English', videoId: 'vid', signal: ctl.signal });

        src.arrives('vid');
        src.arrives('vid');

        expect(refetched).toHaveLength(2);
    });
});
