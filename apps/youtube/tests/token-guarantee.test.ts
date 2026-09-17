/**
 * @jest-environment jsdom
 *
 * The token path, driven end to end.
 *
 * Each piece is tested on its own elsewhere. What this adds is the claim the
 * whole effort rests on and no single unit can make: that the failures actually
 * recorded in the field now end in subtitles.
 *
 * The measurement that started it, across four live traces (202 requests):
 *
 *     with a token   :  44 requests ->  39 loaded (89%)
 *     without a token: 158 requests ->   0 loaded (0%)
 *
 * Zero. So every question about reliability here is the same question: does a
 * token end up on the request. These tests replay the three shapes the traces
 * showed losing one, and assert the chain recovers.
 */
import {
    POT_WAIT_MS,
    PotStore,
    awaitPot,
    worthRetryingWithToken,
} from '../src/content/pot';
import { LateTokenRescue } from '../src/content/late-token-rescue';

const BASE = 'https://www.youtube.com/watch?v=vid';
const timedtext = (params: Record<string, string>) => {
    const u = new URL('https://www.youtube.com/api/timedtext');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
};

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

/**
 * A miniature of the page-script's fetch path: the four fixes wired the way
 * page-script.ts wires them, with the network and clock driven by hand.
 */
function pageLike(store: PotStore) {
    const requests: Array<{ key: string; pot: string | null }> = [];
    const loaded: string[] = [];
    const rescuable = new Map<string, { videoId: string }>();
    let clock = 0;

    const rescue: LateTokenRescue = new LateTokenRescue({
        onToken: (fn) => store.onToken(fn),
        refetch: (key) => {
            const r = rescuable.get(key);
            if (r) void fetchTrack(key, r.videoId, ctl.signal);
        },
    });
    const ctl = new AbortController();

    /** The endpoint's real rule: no token, no subtitles. */
    async function fetchTrack(key: string, videoId: string, signal: AbortSignal): Promise<boolean> {
        // Fix 2: give an arriving token a bounded chance before spending a request.
        await awaitPot(() => store.get(videoId), {
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
            signal,
        });

        const pot = store.get(videoId);
        requests.push({ key, pot });
        if (pot) {
            loaded.push(key);
            return true;
        }
        // Fix 4: a doomed round arms a rescue instead of retrying blind.
        const failure = 'stale-url';
        if (worthRetryingWithToken(failure)) {
            rescuable.set(key, { videoId });
            rescue.arm({ reqKey: key, videoId, signal });
        }
        return false;
    }

    return {
        requests,
        loaded,
        rescue,
        signal: ctl.signal,
        abort: () => ctl.abort(),
        fetchTrack: (key: string, videoId: string) => fetchTrack(key, videoId, ctl.signal),
        /** The page captures a token, as the XHR sniffer would. */
        tokenArrives: (videoId: string, pot = 'TOKEN') =>
            store.capture(timedtext({ v: videoId, pot }), BASE),
    };
}

describe('the failures the traces recorded now end in subtitles', () => {
    /**
     * Trace shape 1 — RkonDCcrZwo.
     *
     * A token was captured and served four requests at t=1032763. The page
     * reloaded. At t=1309460, same tab and same video, every lookup missed and
     * all six following requests went out bare, ending in "no subtitles" on a
     * video whose subtitles had loaded minutes earlier.
     */
    test('a reload no longer loses a token that was already working', async () => {
        const storage = memoryStorage();

        // Before the reload: the token is captured and the track loads.
        const before = pageLike(new PotStore(storage));
        before.tokenArrives('vid');
        await before.fetchTrack('vid:English', 'vid');
        expect(before.loaded).toEqual(['vid:English']);

        // The reload: a brand-new MAIN world, as the browser would build.
        const after = pageLike(new PotStore(storage));
        await after.fetchTrack('vid:English', 'vid');

        expect(after.loaded).toEqual(['vid:English']);
        expect(after.requests).toEqual([{ key: 'vid:English', pot: 'TOKEN' }]);
    });

    /**
     * Trace shape 2 — the +92..+97ms cases.
     *
     * The token was already on its way when our first request went out; we beat
     * it by under a tenth of a second and spent a guaranteed-empty request.
     */
    test('a token in flight is waited for, not raced', async () => {
        const store = new PotStore();
        const page = pageLike(store);

        // It lands during the wait, as the player's own caption request does.
        setTimeout(() => page.tokenArrives('vid'), 0);
        const p = page.fetchTrack('vid:English', 'vid');
        await Promise.resolve();
        page.tokenArrives('vid');
        await p;

        expect(page.loaded).toEqual(['vid:English']);
        // The point: ONE request, and it carried the token.
        expect(page.requests).toHaveLength(1);
        expect(page.requests[0].pot).toBe('TOKEN');
    });

    /**
     * Trace shape 3 — W1tCDAbnLc4, the 46% of mints that time out.
     *
     *     t=272399  mint_done  present=false   <- we stopped listening
     *     t=346201  sniffed    present=true    <- +73.8s, nobody watching
     */
    test('a token that arrives long after the failure still loads the track', async () => {
        const store = new PotStore();
        const page = pageLike(store);

        // The doomed round, exactly as recorded: no token anywhere.
        await page.fetchTrack('vid:English', 'vid');
        expect(page.loaded).toEqual([]);
        expect(page.requests).toEqual([{ key: 'vid:English', pot: null }]);

        // Much later — the trace says 73.8 seconds — the player signs a request.
        page.tokenArrives('vid');
        await Promise.resolve();

        expect(page.loaded).toEqual(['vid:English']);
        expect(page.requests[1].pot).toBe('TOKEN');
    });

    test('both tracks of a video are recovered by one late token', async () => {
        const store = new PotStore();
        const page = pageLike(store);

        await page.fetchTrack('vid:English', 'vid');
        await page.fetchTrack('vid:Russian', 'vid');
        expect(page.loaded).toEqual([]);

        page.tokenArrives('vid');
        await Promise.resolve();

        expect(page.loaded.sort()).toEqual(['vid:English', 'vid:Russian']);
    });
});

/**
 * The other half of the goal, and the one that is easy to lose while chasing
 * the first: recovering must not be paid for with requests.
 */
describe('recovery never costs a burst', () => {
    test('a track that cannot be helped sends exactly one request', async () => {
        const store = new PotStore();
        const page = pageLike(store);

        await page.fetchTrack('vid:English', 'vid');

        // No token ever comes. The old path spent three; this spends one and
        // then waits silently.
        expect(page.requests).toHaveLength(1);
        expect(page.rescue.size).toBe(1);
    });

    test('waiting for a token spends nothing until one arrives', async () => {
        const store = new PotStore();
        const page = pageLike(store);

        await page.fetchTrack('vid:English', 'vid');
        const spent = page.requests.length;

        // Time passes; other videos get tokens; ours does not.
        page.tokenArrives('some-other-video');
        await Promise.resolve();

        expect(page.requests).toHaveLength(spent);
    });

    test('the rescue refetches once, not once per announcement', async () => {
        const store = new PotStore();
        const page = pageLike(store);
        await page.fetchTrack('vid:English', 'vid');

        // first-token-wins means the store announces once however often the
        // page captures; assert the end state rather than the mechanism.
        page.tokenArrives('vid');
        page.tokenArrives('vid', 'SECOND');
        page.tokenArrives('vid', 'THIRD');
        await Promise.resolve();

        expect(page.requests).toHaveLength(2); // the doomed one, then the rescue
    });

    test('a navigation stops a pending rescue from ever firing', async () => {
        const store = new PotStore();
        const page = pageLike(store);
        await page.fetchTrack('vid:English', 'vid');

        page.abort();
        page.tokenArrives('vid');
        await Promise.resolve();

        expect(page.requests).toHaveLength(1);
        expect(page.rescue.size).toBe(0);
    });

    /**
     * The ceiling that keeps fix 2 from becoming the outage of 9cf1f39, where a
     * 15s block plus a 'no-pot' verdict meant a missed sniff stopped subtitles.
     */
    test('a video whose token never comes still answers promptly', async () => {
        const store = new PotStore();
        let clock = 0;
        const got = await awaitPot(() => store.get('vid'), {
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
        });

        expect(got).toBeNull();
        expect(clock).toBeLessThanOrEqual(POT_WAIT_MS + 100);
    });
});
