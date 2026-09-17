/**
 * Collapsing duplicate timedtext requests — behaviour map §3.4.
 *
 * Duplicate YT_FETCH_VTT messages for one track are routine, not exceptional:
 * yt-navigate-finish fires several times for a single navigation, "Search
 * again" re-sends the plan, and a prefs change re-runs it too. Each duplicate
 * used to mean a fresh burst of up to four requests against an endpoint that
 * rate limits per client.
 *
 * The dedup existed already; it was keyed on the built URL, which is the one
 * thing about a repeated request that is guaranteed to differ. A timedtext URL
 * carries `ei=`, `signature=` and (when known) `pot=`, all of which change
 * between navigations while the track being asked for stays the same. Measured
 * on a live trace: across six sessions the dedup never collapsed a single
 * request, and every url_resolved event reported changed=true.
 *
 * The key here is the request key the isolated world already assigns —
 * `<videoId>:<TrackLabel>` from planTrackRequests — which names the track and
 * nothing about how this particular URL was signed.
 */
import { InFlightFetches } from '../src/content/in-flight-fetches';

/** A promise plus the handles to settle it, so ordering is driven by hand. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('InFlightFetches', () => {
    test('a second request for the same track reuses the first', async () => {
        const inFlight = new InFlightFetches<string>();
        const d = deferred<string>();
        const task = jest.fn(() => d.promise);

        const a = inFlight.run('vid:English', task);
        const b = inFlight.run('vid:English', task);

        expect(task).toHaveBeenCalledTimes(1);
        d.resolve('body');
        await expect(a).resolves.toBe('body');
        await expect(b).resolves.toBe('body');
    });

    /**
     * The whole point of the change. Under the old URL key these two were
     * different entries, so the second one fired a fresh burst.
     */
    test('a differently-signed URL for the same track still collapses', async () => {
        const inFlight = new InFlightFetches<string>();
        const d = deferred<string>();
        // Each call would build a URL with a fresh ei=/signature=; the key does
        // not carry them, so the caller never gets the chance to differ.
        const task = jest.fn(() => d.promise);

        inFlight.run('vid:Russian', task);
        inFlight.run('vid:Russian', task);
        inFlight.run('vid:Russian', task);

        expect(task).toHaveBeenCalledTimes(1);
        d.resolve('x');
    });

    test('different tracks of the same video do not collapse into each other', async () => {
        const inFlight = new InFlightFetches<string>();
        const task = jest.fn(async () => 'x');

        await inFlight.run('vid:English', task);
        await inFlight.run('vid:Russian', task);

        expect(task).toHaveBeenCalledTimes(2);
    });

    test('the same track on a different video does not collapse', async () => {
        const inFlight = new InFlightFetches<string>();
        const task = jest.fn(async () => 'x');

        await inFlight.run('one:English', task);
        await inFlight.run('two:English', task);

        expect(task).toHaveBeenCalledTimes(2);
    });

    /**
     * Dedup is only about requests in flight AT THE SAME TIME. A track that
     * finished must be fetchable again — that is what "Search again" is, and
     * what the pot cascade does immediately after its first attempt returns.
     */
    test('a finished request does not block the next one', async () => {
        const inFlight = new InFlightFetches<string>();
        const task = jest.fn(async () => 'x');

        await inFlight.run('vid:English', task);
        await inFlight.run('vid:English', task);

        expect(task).toHaveBeenCalledTimes(2);
    });

    test('a rejected request does not wedge the key', async () => {
        const inFlight = new InFlightFetches<string>();
        const failing = jest.fn(async () => {
            throw new Error('network');
        });

        await expect(inFlight.run('vid:English', failing)).rejects.toThrow('network');
        // Without the cleanup running on the failure path too, this key would
        // hand back the rejected promise forever.
        const ok = jest.fn(async () => 'x');
        await expect(inFlight.run('vid:English', ok)).resolves.toBe('x');
        expect(ok).toHaveBeenCalledTimes(1);
    });

    test('a reused request is reported, so the trace shows why it sent nothing', async () => {
        const inFlight = new InFlightFetches<string>();
        const d = deferred<string>();
        const reused: string[] = [];

        inFlight.run('vid:English', () => d.promise);
        inFlight.run('vid:English', () => d.promise, (key) => reused.push(key));

        expect(reused).toEqual(['vid:English']);
        d.resolve('x');
    });

    /**
     * Navigating to another video aborts the in-flight requests. Their promises
     * still settle (as 'aborted'), but the new video must not be handed one of
     * them in the meantime — and under track keying that is newly possible,
     * since two videos CAN share a track label and the abandoned entry outlives
     * the navigation by however long the abort takes to propagate.
     */
    test('clear() releases the keys, so the next video is not handed an abandoned run', async () => {
        const inFlight = new InFlightFetches<string>();
        const abandoned = deferred<string>();
        const first = jest.fn(() => abandoned.promise);
        inFlight.run('vid:English', first);

        inFlight.clear();

        const second = jest.fn(async () => 'fresh');
        await expect(inFlight.run('vid:English', second)).resolves.toBe('fresh');
        expect(second).toHaveBeenCalledTimes(1);
        abandoned.resolve('stale');
    });

    test('a cleared run settling later does not evict the run that replaced it', async () => {
        const inFlight = new InFlightFetches<string>();
        const abandoned = deferred<string>();
        inFlight.run('vid:English', () => abandoned.promise);
        inFlight.clear();

        const live = deferred<string>();
        const replacement = jest.fn(() => live.promise);
        inFlight.run('vid:English', replacement);

        // The abandoned request settles now — its cleanup must not delete the
        // key the replacement is holding, or a third caller would start a
        // SECOND concurrent request for a track already being fetched.
        abandoned.resolve('stale');
        await Promise.resolve();
        await Promise.resolve();

        const third = jest.fn(async () => 'third');
        const got = inFlight.run('vid:English', third);

        // The third caller must have been handed the replacement's run, not
        // started one of its own.
        expect(third).not.toHaveBeenCalled();
        live.resolve('live');
        await expect(got).resolves.toBe('live');
        expect(replacement).toHaveBeenCalledTimes(1);
    });

    test('the first request reports nothing — it is not a reuse', async () => {
        const inFlight = new InFlightFetches<string>();
        const reused: string[] = [];

        await inFlight.run('vid:English', async () => 'x', (key) => reused.push(key));

        expect(reused).toEqual([]);
    });
});
