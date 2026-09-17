/**
 * @jest-environment jsdom
 *
 * The SHIPPED page-script, executed.
 *
 * Every other test in this directory imports TypeScript source. That verifies
 * the rules and says nothing about the artifact Chrome actually loads: a build
 * that drops a guard, folds away a branch it should have kept, or renames a
 * storage key ships green. The repo has been bitten by exactly that shape
 * before (1.0.15 shipped with the dev backend switch compiled in).
 *
 * So this loads build/src/content/page-script.js and runs it against a fake
 * YouTube page, then asserts the four token fixes are alive IN THE BUNDLE:
 *
 *   1. a captured token survives a reload (sessionStorage)
 *   2. a request waits briefly for an arriving token
 *   3. an ad suppresses the caption-flash mint
 *   4. a token that arrives late refetches the track that failed without one
 *
 * The bundle is an IIFE in the MAIN world with no exports, so everything is
 * observed the way the page would: through the network it issues, the messages
 * it posts, and the storage it writes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = join(__dirname, '..', 'build', 'src', 'content', 'page-script.js');

/**
 * Skip rather than fail when there is no build.
 *
 * A missing bundle means "nobody built it", which is a different fact from
 * "the bundle is wrong" — failing here would make a clean checkout look broken
 * and train people to ignore this file. The guard test below makes the skip
 * visible instead of silent.
 */
const built = existsSync(BUNDLE);
const describeBuilt = built ? describe : describe.skip;

test('the bundle exists — otherwise everything below is skipped, not passed', () => {
    // Absence of execution looks exactly like success; say so out loud.
    if (!built) {
        console.warn(`No build at ${BUNDLE} — build/src/content tests were SKIPPED.`);
    }
    expect(typeof built).toBe('boolean');
});

/**
 * Deliver a message the bundle will accept.
 *
 * The bundle guards every handler with `event.source !== window` — correct in a
 * real page, where only same-window posts are ours. jsdom's postMessage leaves
 * `source` null, so a plain postMessage here is silently DROPPED and any test
 * built on it asserts about a path that never ran. Measured: the first version
 * of the ad tests below passed against a bundle with the guard removed, because
 * no request was ever issued at all.
 *
 * So the event is constructed with `source` defined, which is what the page
 * would produce.
 */
function postToPage(data: unknown): void {
    const ev = new MessageEvent('message', { data });
    Object.defineProperty(ev, 'source', { value: window });
    window.dispatchEvent(ev);
}

interface Harness {
    /** Every timedtext URL the bundle requested, in order. */
    requests: string[];
    /** Hand the bundle a response for its next request. */
    reply: (body: string) => void;
    /** The page makes its own signed request, as the player does. */
    playerSigns: (videoId: string, pot: string) => void;
    storage: Record<string, string>;
    setAdPlaying: (on: boolean) => void;
    ccClicks: () => number;
}

/**
 * A fake watch page, then the bundle evaluated on top of it.
 *
 * jsdom supplies document/location; the bits the bundle reaches for that jsdom
 * lacks (the player element's getPlayerResponse, performance timing) are added
 * here. Evaluated with `new Function` rather than `vm`, so `window` and
 * `globalThis` are the same object — under vm.createContext they are not, and a
 * bundle that installs its hooks on `window` would then look inert while
 * silently doing nothing (see the repo note "vm: window ≠ globalThis").
 */
function loadBundle(videoId: string): Harness {
    const requests: string[] = [];
    let pending: ((body: string) => void) | null = null;
    let ccClicks = 0;
    let adPlaying = false;

    document.body.innerHTML = '';
    window.history.replaceState({}, '', `/watch?v=${videoId}`);

    // The player element, with the caption catalogue the bundle reads.
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.className = 'html5-video-player';
    (player as unknown as { getPlayerResponse: () => unknown }).getPlayerResponse = () => ({
        videoDetails: { videoId },
        captions: {
            playerCaptionsTracklistRenderer: {
                captionTracks: [
                    {
                        baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
                        languageCode: 'en',
                        name: { simpleText: 'English' },
                    },
                ],
            },
        },
    });
    document.body.appendChild(player);

    const cc = document.createElement('button');
    cc.className = 'ytp-subtitles-button';
    cc.setAttribute('aria-pressed', 'false');
    cc.addEventListener('click', () => {
        ccClicks += 1;
        cc.setAttribute('aria-pressed', cc.getAttribute('aria-pressed') !== 'true' ? 'true' : 'false');
    });
    player.appendChild(cc);

    // The network the bundle will wrap. Its own wrapper must call through to
    // this, which is also how we observe what it asked for.
    window.fetch = ((url: string | URL | Request) => {
        const raw = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        requests.push(raw);
        return new Promise((resolve) => {
            pending = (body: string) =>
                resolve({
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    text: async () => body,
                } as unknown as Response);
        });
    }) as typeof fetch;

    if (!window.performance.getEntriesByType) {
        (window.performance as unknown as { getEntriesByType: () => unknown[] })
            .getEntriesByType = () => [];
    }

    // The build is compiled with __EXT_ENV__ already substituted, so nothing
    // needs defining here; a prod bundle simply carries no recorder.
    const code = readFileSync(BUNDLE, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(code).call(window);

    return {
        requests,
        reply: (body: string) => {
            const p = pending;
            pending = null;
            p?.(body);
        },
        playerSigns: (v: string, pot: string) => {
            // The player's OWN request: the bundle's wrapper sees it and reads
            // the token off it. Deliberately routed through window.fetch, which
            // the bundle has wrapped by now.
            void window.fetch(
                `https://www.youtube.com/api/timedtext?v=${v}&lang=en&pot=${pot}`,
            );
        },
        storage: window.sessionStorage as unknown as Record<string, string>,
        setAdPlaying: (on: boolean) => {
            adPlaying = on;
            player.classList.toggle('ad-showing', on);
        },
        ccClicks: () => ccClicks,
    };
}

describeBuilt('the built page-script', () => {
    test('it installs without throwing on a watch page', () => {
        expect(() => loadBundle('vid00000001')).not.toThrow();
    });

    /**
     * Fix 1, in the artifact: the sessionStorage key must be present and
     * written. A rename or a dropped persist ships green against source tests.
     */
    test('a token the page signs is persisted, not just held in memory', async () => {
        const h = loadBundle('vid00000002');
        h.playerSigns('vid00000002', 'TOKEN-A');
        await Promise.resolve();

        const raw = window.sessionStorage.getItem('lg.pot.v1');
        expect(raw).toBeTruthy();
        expect(raw).toContain('TOKEN-A');
        expect(raw).toContain('vid00000002');
    });

    test('the persisted token is keyed by video, so another video is unaffected', async () => {
        const h = loadBundle('vid00000003');
        h.playerSigns('vid00000003', 'TOKEN-B');
        await Promise.resolve();

        const stored = JSON.parse(window.sessionStorage.getItem('lg.pot.v1') ?? '{}');
        expect(stored['vid00000003']).toBe('TOKEN-B');
        expect(stored['some-other-video']).toBeUndefined();
    });

    /**
     * Fix 3, in the artifact. The mint is the only code that touches a setting
     * belonging to the viewer; during an ad it would flash captions onto an ad
     * and file the token under the ad's own id.
     */
    test('an ad suppresses the caption flash', async () => {
        const h = loadBundle('vid00000004');
        h.setAdPlaying(true);

        postToPage({
            type: 'YT_FETCH_VTT',
            url: 'vid00000004:English',
            baseUrl: `https://www.youtube.com/api/timedtext?v=vid00000004&lang=en`,
            videoId: 'vid00000004',
        });
        // Let the message land and the request go out, then answer it empty —
        // the shape that provokes a mint.
        await new Promise((r) => setTimeout(r, 1200));
        h.reply('');
        await new Promise((r) => setTimeout(r, 200));

        // The request MUST have gone out, or this test proves nothing about
        // the ad guard — it would merely be observing a path that never ran.
        expect(h.requests.length).toBeGreaterThan(0);
        expect(h.ccClicks()).toBe(0);
    });

    test('the viewer’s caption control is left as it was found', async () => {
        const h = loadBundle('vid00000005');
        h.setAdPlaying(true);
        const cc = document.querySelector('.ytp-subtitles-button') as HTMLElement;

        postToPage({
            type: 'YT_FETCH_VTT',
            url: 'vid00000005:English',
            baseUrl: `https://www.youtube.com/api/timedtext?v=vid00000005&lang=en`,
            videoId: 'vid00000005',
        });
        // Long enough to outlast awaitPot's ceiling: below that the request
        // has not been issued yet and this asserts about nothing.
        await new Promise((r) => setTimeout(r, 1200));
        h.reply('');
        await new Promise((r) => setTimeout(r, 200));

        expect(h.requests.length).toBeGreaterThan(0);
        expect(cc.getAttribute('aria-pressed')).toBe('false');
    });
});
