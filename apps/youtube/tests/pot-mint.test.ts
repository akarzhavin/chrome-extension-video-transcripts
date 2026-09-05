/**
 * @jest-environment jsdom
 *
 * The routine that briefly turns the viewer's captions ON to make the player
 * sign a request — behaviour map §3.5–§3.7.
 *
 * It is the only code in the extension that touches a setting belonging to the
 * viewer rather than to us, on a video they did not ask to have captions on.
 * Everything here is about giving it back: the control returns to the state it
 * was found in, the flash is bounded, it happens once, and the viewer is never
 * told any of it happened.
 *
 * Until the routine was extracted (previous commit) it lived inside a
 * document_start closure in the MAIN world, so none of that was asserted.
 */
import {
    doMintPotViaCcToggle,
    POT_POLL_MS,
    POT_TOGGLE_TIMEOUT_MS,
    SharedOnce,
    type MintDeps,
} from '../src/content/pot';

const VIDEO = 'dQw4w9WgXcQ';

/** A CC control in the state the player would leave it. */
function ccButton(pressed: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'ytp-subtitles-button';
    btn.setAttribute('aria-pressed', String(pressed));
    // The real control flips its own state when clicked; without this the
    // routine's restore step has nothing to react to.
    btn.addEventListener('click', () => {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
    });
    document.body.appendChild(btn);
    return btn;
}

interface Harness {
    deps: MintDeps;
    once: SharedOnce<string | null>;
    clicks: () => number;
    /** Hand the routine a token, as the sniffer would once the player signs. */
    tokenArrives: (value: string) => void;
    /** Move the fake clock, so the budget can be reached without waiting. */
    advance: (ms: number) => void;
    logged: string[];
}

function harness(over: Partial<{ token: string | null; urlVideo: string | null }> = {}): Harness {
    let token: string | null = over.token ?? null;
    let clock = 1_000_000;
    let clicks = 0;
    const logged: string[] = [];

    document.addEventListener('click', () => { clicks += 1; }, true);

    const deps: MintDeps = {
        ccToggle: () => document.querySelector<HTMLElement>('.ytp-subtitles-button'),
        knownPot: () => token,
        currentUrlVideoId: () => (over.urlVideo === undefined ? VIDEO : over.urlVideo),
        // The clock only moves when a test says so, so the four-second budget
        // is reached deterministically rather than waited out.
        sleep: async (ms) => { clock += ms; },
        now: () => clock,
        log: (m) => logged.push(m),
    };

    return {
        deps,
        once: new SharedOnce<string | null>(),
        clicks: () => clicks,
        tokenArrives: (v) => { token = v; },
        advance: (ms) => { clock += ms; },
        logged,
    };
}

const live = (): AbortSignal => new AbortController().signal;

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('minting a token by flashing the captions on', () => {
    test('it clicks, reads the token, and puts the control back', async () => {
        const h = harness();
        const btn = ccButton(false);
        // The player signs a request almost immediately on a healthy page.
        h.deps.knownPot = () => (h.clicks() > 0 ? 'the-token' : null);

        const got = await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(got).toBe('the-token');
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    test('the control goes back even when no token ever arrives', async () => {
        const h = harness();
        const btn = ccButton(false);

        const got = await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(got).toBeNull();
        // The viewer's captions must not be left on because our optimisation
        // failed — that is a visible change to their video for nothing.
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    // Captions already on means the player has its track and we simply missed
    // the sniff. Toggling would turn the viewer's captions OFF and mint
    // nothing — the opposite of the routine's whole purpose.
    test('captions the viewer already had on are left on, and nothing is clicked', async () => {
        const h = harness({ token: 'already-known' });
        const btn = ccButton(true);

        const got = await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(got).toBe('already-known');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(h.clicks()).toBe(0);
    });

    // After a navigation the control on screen belongs to the NEW video, and
    // YouTube persists the CC preference across videos — restoring blindly
    // would switch captions off on a video we never touched.
    test('it does not restore a control that now belongs to another video', async () => {
        const h = harness({ urlVideo: 'some-other-video' });
        const btn = ccButton(false);

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(btn.getAttribute('aria-pressed')).toBe('true'); // left as the new video's
        expect(h.clicks()).toBe(1); // clicked once, never clicked back
    });
});

describe('the budget', () => {
    // Pinned to the literal, not read back from the module and compared with
    // itself: a check that asks the code what it chose can never disagree.
    test('is four seconds', () => {
        expect(POT_TOGGLE_TIMEOUT_MS).toBe(4000);
    });

    test('is polled about seven times a second', () => {
        expect(POT_POLL_MS).toBe(150);
    });

    test('a token arriving just inside it is still taken', async () => {
        const h = harness();
        ccButton(false);
        let elapsed = 0;
        h.deps.sleep = async (ms) => { elapsed += ms; h.advance(ms); };
        h.deps.knownPot = () => (elapsed >= 3900 ? 'late-but-in-time' : null);

        await expect(doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps)).resolves.toBe('late-but-in-time');
        expect(elapsed).toBeLessThan(4000);
    });

    test('it gives up rather than flashing captions indefinitely', async () => {
        const h = harness();
        const btn = ccButton(false);
        let elapsed = 0;
        h.deps.sleep = async (ms) => { elapsed += ms; h.advance(ms); };

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        // Stopped at the budget, not one poll later and not forever.
        expect(elapsed).toBeGreaterThanOrEqual(4000);
        expect(elapsed).toBeLessThan(4000 + POT_POLL_MS * 2);
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    test('an abort stops the wait early, and still restores', async () => {
        const h = harness();
        const btn = ccButton(false);
        const ctl = new AbortController();
        let elapsed = 0;
        h.deps.sleep = async (ms) => {
            elapsed += ms;
            h.advance(ms);
            if (elapsed >= 300) ctl.abort();
        };

        await doMintPotViaCcToggle(VIDEO, ctl.signal, h.once, h.deps);

        expect(elapsed).toBeLessThan(1000); // nowhere near the full budget
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('how often it may happen', () => {
    // The flash is visible. Twice on one video would read as the player
    // glitching, and the guard is what stops every parallel track from each
    // asking for their own.
    // Through the guard, as page-script.ts calls it: the routine itself does
    // not re-check, it MARKS the video as attempted and SharedOnce.run turns
    // later callers away. Calling the routine directly twice would bypass the
    // very thing under test.
    const mintThroughGuard = (h: Harness, videoId = VIDEO) =>
        h.once.run(
            videoId,
            () => doMintPotViaCcToggle(videoId, live(), h.once, h.deps),
            () => h.deps.knownPot(videoId),
        );

    test('a second call for the same video does not click again', async () => {
        const h = harness();
        ccButton(false);

        await mintThroughGuard(h);
        expect(h.clicks()).toBe(2); // on, then restored

        await mintThroughGuard(h);
        expect(h.clicks()).toBe(2); // unchanged

        // And the routine marked it, which is what turns the second call away.
        expect(h.once.hasCompleted(VIDEO)).toBe(true);
    });

    // Every track of a video asks at once (index.ts fans the plan out in
    // parallel). They must share one flash, not queue up four of them.
    test('parallel callers share a single flash', async () => {
        const h = harness();
        ccButton(false);
        h.deps.knownPot = () => (h.clicks() > 0 ? 'shared' : null);

        const all = await Promise.all([mintThroughGuard(h), mintThroughGuard(h), mintThroughGuard(h)]);

        expect(all).toEqual(['shared', 'shared', 'shared']);
        expect(h.clicks()).toBe(2); // one on, one restore — not three of each
    });

    // The player chrome renders late and this runs seconds into the page.
    // Claiming the attempt against a button that had not appeared would burn
    // the one mint the video gets, and every later track and every "Search
    // again" would return nothing without ever clicking the control that does
    // exist by then.
    test('no control yet is not a spent attempt', async () => {
        const h = harness();

        const got = await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(got).toBeNull();
        expect(h.clicks()).toBe(0);
        expect(h.once.hasCompleted(VIDEO)).toBe(false);

        // The control renders, and now the attempt goes through.
        ccButton(false);
        h.deps.knownPot = () => (h.clicks() > 0 ? 'minted' : null);
        await expect(doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps)).resolves.toBe('minted');
        expect(h.clicks()).toBeGreaterThan(0);
    });

    test('a different video gets its own attempt', async () => {
        const h = harness();
        ccButton(false);

        await mintThroughGuard(h);
        const after = h.clicks();

        await mintThroughGuard(h, 'another-video');
        expect(h.clicks()).toBeGreaterThan(after);
    });
});

// The whole operation is four seconds of someone else's captions appearing and
// disappearing. Explaining it in the panel would make a background optimisation
// into an event the viewer has to read and dismiss.
describe('what the viewer is told', () => {
    test('nothing is added to the page, and nothing is removed from it', async () => {
        const h = harness();
        ccButton(false);
        // Measured as a delta, not as an absolute: "the page is empty" would
        // also hold in a world where the routine never ran at all.
        const before = document.body.innerHTML;
        const countBefore = document.body.childElementCount;

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(document.body.childElementCount).toBe(countBefore);
        expect(document.body.innerHTML).toBe(before);
    });

    test('nothing is added on the failing path either', async () => {
        const h = harness();
        ccButton(false);
        const before = document.body.innerHTML;

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps); // no token ever

        expect(document.body.innerHTML).toBe(before);
    });

    test('the status line is never touched', async () => {
        const status = document.createElement('div');
        status.id = 'vtt-status';
        status.textContent = 'Loading subtitles';
        document.body.appendChild(status);
        const h = harness();
        ccButton(false);

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(document.getElementById('vtt-status')?.textContent).toBe('Loading subtitles');
    });

    // What it does say goes to the console, where a developer reading a live
    // session can see the cascade. That is diagnostics, not an announcement.
    test('what it says goes to the log, not to the page', async () => {
        const h = harness();
        ccButton(false);

        await doMintPotViaCcToggle(VIDEO, live(), h.once, h.deps);

        expect(h.logged.join(' ')).toMatch(/briefly enabling native captions/i);
        expect(h.logged.join(' ')).toMatch(/restored/i);
        expect(document.body.textContent).toBe('');
    });
});
