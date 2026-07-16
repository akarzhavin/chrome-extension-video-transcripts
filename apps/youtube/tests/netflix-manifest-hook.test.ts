/**
 * @jest-environment jsdom
 */
// NOTE: the hook is imported per-test via jest.isolateModules (see beforeEach) —
// it permanently wraps JSON.parse and guards against double-install on the shared
// jsdom window, so a module-level import would leak state between tests.

// A minimal manifest payload shaped the way findManifestResult() looks for it:
// a node carrying a movieId plus a timedtexttracks array whose entries have
// `downloadables`/`isNoneTrack`.
const manifestJson = (movieId: string, trackCount = 2): string =>
    JSON.stringify({
        result: {
            movieId,
            timedtexttracks: Array.from({ length: trackCount }, (_, i) => ({
                language: `l${i}`,
                downloadables: {},
            })),
        },
    });

// postMessage in jsdom is async (queued as a task) — let the queue drain.
const flush = () => new Promise((r) => setTimeout(r, 0));

// Send an NFLX_QUERY the way the content script does.
//
// NOT window.postMessage: jsdom leaves `event.source` null on it, and the hook
// (correctly) ignores messages whose source isn't this window — that guard is
// what rejects cross-frame messages in a real browser. So dispatch a MessageEvent
// with source set, which is what a browser delivers for a same-window post.
function query(movieId: string | null): void {
    window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'NFLX_QUERY', movieId }, source: window }),
    );
}

// Collect NFLX_MANIFEST messages the hook posts back to the page.
//
// Capturing a manifest ALSO broadcasts it (that's how a content script already
// attached learns about a new title), and those posts are queued async. So drain
// the queue before listening — otherwise a capture broadcast lands in `seen` and
// reads as if it were the answer to a query we hadn't sent yet.
type Captured = { movieId: string; tracks: unknown[] };
async function listenForManifests(): Promise<{ seen: Captured[]; stop: () => void }> {
    await flush();
    const seen: Captured[] = [];
    const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'NFLX_MANIFEST') {
            seen.push({ movieId: String(e.data.movieId), tracks: e.data.tracks });
        }
    };
    window.addEventListener('message', onMsg);
    return { seen, stop: () => window.removeEventListener('message', onMsg) };
}

describe('netflix manifest hook cache', () => {
    let stop: (() => void) | null = null;
    let realParse: typeof JSON.parse;
    let realStringify: typeof JSON.stringify;
    let uninstall: (() => void) | null = null;

    beforeEach(() => {
        // A hook installs for the life of the page: it wraps JSON.parse/stringify
        // irreversibly and adds a permanent message listener. Tests share one jsdom
        // window, so without a real teardown each test's hook would keep answering
        // later tests' queries from its own cache. Snapshot JSON, intercept the
        // listener registration so we can remove it, and load a fresh module copy
        // (the install guard is per-window and would otherwise block re-install).
        realParse = JSON.parse;
        realStringify = JSON.stringify;
        // jsdom ships no window.fetch; the hook binds it at install time.
        (window as unknown as { fetch: unknown }).fetch = jest.fn();
        delete (window as unknown as { __lingogramNflxHook?: boolean }).__lingogramNflxHook;

        // Capture the hook's message listener so afterEach can remove it. The hook
        // registers exactly one; nothing else registers during install.
        const realAdd = window.addEventListener.bind(window);
        const realRemove = window.removeEventListener.bind(window);
        const addSpy = jest
            .spyOn(window, 'addEventListener')
            .mockImplementation((
                type: string,
                listener: EventListenerOrEventListenerObject,
                opts?: boolean | AddEventListenerOptions,
            ) => {
                if (type === 'message') uninstall = () => realRemove(type, listener, opts);
                realAdd(type, listener, opts);
            });
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../src/content/netflix/manifest-hook').installNetflixHook();
        });
        addSpy.mockRestore();
    });

    afterEach(() => {
        stop?.();
        stop = null;
        uninstall?.();
        uninstall = null;
        JSON.parse = realParse;
        JSON.stringify = realStringify;
    });

    it('answers a query for a title captured earlier', async () => {
        JSON.parse(manifestJson('111'));
        const l = await listenForManifests();
        stop = l.stop;

        query('111');
        await flush();

        expect(l.seen).toHaveLength(1);
        expect(l.seen[0].movieId).toBe('111');
        expect(l.seen[0].tracks).toHaveLength(2);
    });

    // The slow-loading-title bug: the URL flips to the new id before Netflix
    // parses the new manifest. The hook must NOT answer with the previous
    // title's manifest — the content script would discard it (movieId != url id)
    // and every later retry would replay the same stale entry, so only a page
    // reload could recover.
    it('does not answer a query for a title with a different title\'s manifest', async () => {
        JSON.parse(manifestJson('111'));
        const l = await listenForManifests();
        stop = l.stop;

        query('222');
        await flush();

        expect(l.seen).toHaveLength(0);
    });

    // ...and once the slow manifest finally lands, a retry resolves it. This is
    // what makes "Search again" actually work instead of being a no-op.
    it('answers a retry after the slow manifest finally arrives', async () => {
        JSON.parse(manifestJson('111'));
        const l = await listenForManifests();
        stop = l.stop;

        query('222');
        await flush();
        expect(l.seen).toHaveLength(0);

        // Netflix parses the new title's manifest — the hook broadcasts it.
        JSON.parse(manifestJson('222', 3));
        await flush();
        expect(l.seen.map((m) => m.movieId)).toEqual(['222']);

        // And a later query for it is served from cache.
        query('222');
        await flush();
        expect(l.seen.map((m) => m.movieId)).toEqual(['222', '222']);
    });

    // Both titles stay addressable — going back to a previous episode must not
    // re-fetch just because a newer manifest was seen since.
    it('keeps earlier titles addressable after newer ones are captured', async () => {
        JSON.parse(manifestJson('111'));
        JSON.parse(manifestJson('222'));
        const l = await listenForManifests();
        stop = l.stop;

        query('111');
        await flush();

        expect(l.seen.map((m) => m.movieId)).toEqual(['111']);
    });

    // A query with no id falls back to the most recent capture rather than going
    // silent. The content script no longer sends one (queryManifest returns early
    // off /watch, and handleManifest rejects a manifest whose id != the url id) —
    // this stays the hook's documented contract for any other caller, but it is
    // deliberately NOT the content script's stale-manifest defense.
    it('falls back to the newest manifest when the query names no title', async () => {
        JSON.parse(manifestJson('111'));
        JSON.parse(manifestJson('222'));
        const l = await listenForManifests();
        stop = l.stop;

        query(null);
        await flush();

        expect(l.seen.map((m) => m.movieId)).toEqual(['222']);
    });

    it('evicts the oldest manifests past the cache bound', async () => {
        for (let i = 0; i < 10; i++) JSON.parse(manifestJson(`m${i}`));
        const l = await listenForManifests();
        stop = l.stop;

        // m0/m1 evicted (bound is 8); m2 and the newest survive.
        query('m0');
        query('m2');
        query('m9');
        await flush();

        expect(l.seen.map((m) => m.movieId)).toEqual(['m2', 'm9']);
    });
});
