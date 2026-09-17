// ── The timedtext PO token (`pot`) ──────────────────────────────────────────
//
// Extracted from page-script.ts for the same reason the Netflix hook is: the
// rules are worth unit testing, and the page-script body is an IIFE in the MAIN
// world that a test cannot reach.
//
// What this is. As of 2026-08-28 /api/timedtext answers a request WITHOUT `pot`
// as HTTP 200 with a ZERO-BYTE body — measured on a logged-in profile with
// playabilityStatus OK, against the bare signed baseUrl as well as ours. The
// same URL carrying `pot` returns the full track. An empty 200 therefore now
// usually means "no token", not "stale link".
//
// We do not mint the token. The player fetches its own caption track shortly
// after a watch page loads and puts `pot` on that request; we read it there.
//
// The one rule that matters: NOTHING HERE MAY BLOCK. The previous
// implementation (removed in 9cf1f39) waited up to 15s for a token and failed
// the track with 'no-pot' when the sniff missed — so when YouTube briefly
// stopped sending `pot`, subtitles stopped loading entirely. Guaranteeing a
// load means the request always goes out with whatever is known at the time,
// and the token only ever improves a retry.
//
// What a token is worth, measured across four live traces (202 requests):
//
//     with a token   : 44 requests ->  39 loaded (89%)
//     without a token: 158 requests ->  0 loaded (0%)
//
// Zero, not "fewer". So a token that was captured and then forgotten is the
// single most expensive thing that can happen here: it turns every following
// request into a guaranteed empty answer. Hence PotStore persists — see there.

/**
 * Where a surviving token is kept. sessionStorage's own key, versioned so a
 * future shape change cannot be handed stale data.
 */
export const POT_STORAGE_KEY = 'lg.pot.v1';

/** Most videos a tab keeps tokens for. Small: a tab visits a handful. */
const MAX_REMEMBERED = 12;

/**
 * Remembers the token seen for each video id.
 *
 * Optionally backed by a Storage (sessionStorage in the page), because the
 * in-memory map lives exactly as long as the MAIN-world script and a reload
 * builds a fresh one. Measured on a live trace: a token captured and serving
 * requests at t=1032763 was gone 4.6 minutes later on the same tab and the same
 * video, and all six following requests went out tokenless — which on this
 * endpoint is six guaranteed empty answers. Across four traces, 158 tokenless
 * requests produced 0 subtitles, so a forgotten token is not a slower load, it
 * is no load.
 *
 * sessionStorage rather than localStorage because that is the token's own
 * lifetime: it is signed for this session, and a stale one carried into a new
 * tab would occupy the request that could have minted a fresh one.
 *
 * Every storage call is wrapped: a viewer with site data blocked, or a full
 * quota, makes all of them throw, and the token is an optimisation on top of an
 * already-working request path. It may never take the page down.
 */
export class PotStore {
    private byVideoId = new Map<string, string>();
    private listeners = new Set<(videoId: string, pot: string) => void>();

    constructor(private readonly storage?: Storage) {
        this.byVideoId = this.load();
    }

    /**
     * Be told the moment a token for any video is first seen. Returns an
     * unsubscribe function.
     *
     * Exists because a token that arrives AFTER a track gave up used to land in
     * a store nobody read again. Measured across the live traces, that is what
     * the failed mints are: two tracks burn the 4s budget, the video is marked
     * as attempted, and then the token shows up anyway — +5.2s in one session,
     * +73.8s in another. The sessions where it "never" arrived simply ended
     * ~1.6s after we stopped looking.
     *
     * A subscription costs no requests: it fires on a capture that happens
     * regardless, and only tells the truth sooner than the next poll would.
     */
    onToken(fn: (videoId: string, pot: string) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private announce(videoId: string, pot: string): void {
        for (const fn of [...this.listeners]) {
            try {
                fn(videoId, pot);
            } catch {
                // This runs inside the page's own fetch/XHR wrapper: an
                // exception here would surface in YouTube's code, not ours, and
                // one bad subscriber must not silence the rest.
            }
        }
    }

    /**
     * Read `pot` off a URL the page itself requested. Ignores anything that is
     * not a timedtext URL, and keeps the FIRST token seen for a video: later
     * requests carry equivalent tokens, and rewriting the entry would churn the
     * value that in-flight retries are about to use.
     */
    capture(rawUrl: string, base?: string): boolean {
        try {
            const u = new URL(rawUrl, base);
            if (!u.pathname.includes('/api/timedtext')) return false;
            const v = u.searchParams.get('v');
            const pot = u.searchParams.get('pot');
            if (!v || !pot || this.byVideoId.has(v)) return false;
            this.byVideoId.set(v, pot);
            this.persist();
            this.announce(v, pot);
            return true;
        } catch {
            // A URL we cannot parse is simply not a source of tokens.
            return false;
        }
    }

    get(videoId: string): string | null {
        return this.byVideoId.get(videoId) ?? null;
    }

    /** Seed a token found by other means (e.g. resource timing). */
    remember(videoId: string, pot: string): void {
        if (this.byVideoId.has(videoId)) return;
        this.byVideoId.set(videoId, pot);
        this.persist();
        this.announce(videoId, pot);
    }

    private load(): Map<string, string> {
        try {
            const raw = this.storage?.getItem(POT_STORAGE_KEY);
            if (!raw) return new Map();
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
            const out = new Map<string, string>();
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                if (typeof v === 'string' && v) out.set(k, v);
            }
            return out;
        } catch {
            // Unreadable or corrupt storage is the same as an empty one: start
            // fresh rather than refusing to work.
            return new Map();
        }
    }

    private persist(): void {
        if (!this.storage) return;
        try {
            // Drop the oldest first: Map preserves insertion order, and the
            // video being watched now is the last one in.
            const entries = [...this.byVideoId.entries()].slice(-MAX_REMEMBERED);
            this.byVideoId = new Map(entries);
            this.storage.setItem(POT_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch {
            // Blocked site data or a full quota. The in-memory map still holds
            // the token for this page's lifetime, which is what today does.
        }
    }
}

/**
 * Recover a token from resource timing — URLs the wrappers missed because our
 * own request beat the player's, or because the entry predates this script.
 */
export function potFromResourceTiming(
    videoId: string,
    entries: Array<{ name: string }>,
): string | null {
    for (const e of entries) {
        try {
            if (!e.name.includes('/api/timedtext')) continue;
            const u = new URL(e.name);
            if (u.searchParams.get('v') !== videoId) continue;
            const pot = u.searchParams.get('pot');
            if (pot) return pot;
        } catch {
            // Skip an unparseable entry rather than abandoning the search.
        }
    }
    return null;
}

/**
 * Build a timedtext URL. `pot` is only ever ADDED: a caller without a token
 * still gets a well-formed request, which is the point of never blocking.
 */
export function buildTimedTextUrl(
    baseUrl: string,
    opts: { tlang?: string; pot?: string | null; base?: string } = {},
): string {
    const u = new URL(baseUrl, opts.base);
    u.searchParams.set('fmt', 'json3');
    u.searchParams.set('c', 'WEB');
    if (opts.tlang) u.searchParams.set('tlang', opts.tlang);
    if (opts.pot) u.searchParams.set('pot', opts.pot);
    return u.toString();
}

/**
 * Is this outcome the "served nothing" shape — the signature of a missing
 * token? 'stale-url' is what the fetcher calls an empty 200 (it cannot tell the
 * two causes apart from the response alone); 'not-offered' is the same dead end
 * when a token turns out to have been all that was missing.
 */
export function isEmptyish(failure: string | undefined): boolean {
    return failure === 'stale-url' || failure === 'not-offered';
}

/**
 * Could a token that arrives LATER still turn this failure into subtitles?
 *
 * Deliberately broader than isEmptyish, and deliberately a separate function.
 * isEmptyish answers "is this the shape of a missing token", which is what the
 * pot cascade uses to decide whether to flash the viewer's own captions on —
 * and a throttle is not a reason to do that, so widening it would make the
 * extension touch the player's settings on every 429.
 *
 * This asks something else: is a refetch worth arming. On this endpoint a
 * request without a token cannot succeed whatever the status line said, so a
 * 429 that went out bare was doomed before it left, exactly like an empty 200,
 * and a token is equally what it was missing. Measured across the traces: 14
 * failed tokenless rounds ended 'stale-url' and 2 ended 'rate-limited'; the
 * latter were getting no rescue at all.
 *
 * Excluded are the outcomes a token cannot change — the viewer navigated away,
 * or the track is genuinely gone.
 */
const TOKEN_FIXABLE: ReadonlySet<string> = new Set([
    'stale-url',
    'not-offered',
    'rate-limited',
    'cooldown',
    'unknown',
    'network',
]);

export function worthRetryingWithToken(failure: string | undefined): boolean {
    return !!failure && TOKEN_FIXABLE.has(failure);
}

/**
 * Should the empty answer be retried with a token? Only when a token exists now
 * that we did NOT have when the request went out — otherwise the retry re-sends
 * an identical request and launders the same empty answer into a second
 * attempt.
 */
export function shouldRetryWithPot(
    failure: string | undefined,
    potBefore: string | null,
    potNow: string | null,
): boolean {
    if (!isEmptyish(failure)) return false;
    if (!potNow) return false;
    return potNow !== potBefore;
}

/**
 * Run `task` at most once per key, and hand every concurrent caller the SAME
 * promise.
 *
 * Written for pot minting, where the shape of the bug is specific: tracks are
 * fetched in parallel, so on a video that needs a token they all come back
 * empty within milliseconds. A naive "first caller wins, everyone else is
 * turned away" guard returned null to the others — the token existed half a
 * second later, but they had already given up, so dual subtitles collapsed to
 * one language on every video that took that path.
 *
 * `once` records keys whose task has already COMPLETED, so a finished attempt
 * is not repeated; in-flight callers share the running promise instead.
 */
export class SharedOnce<T> {
    private inFlight = new Map<string, Promise<T>>();
    private done = new Set<string>();

    run(key: string, task: () => Promise<T>, whenDone: () => T): Promise<T> {
        const running = this.inFlight.get(key);
        if (running) return running;
        if (this.done.has(key)) return Promise.resolve(whenDone());

        const p = task().finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, p);
        return p;
    }

    /** Mark a key as attempted, so later calls take the whenDone() path. */
    complete(key: string): void {
        this.done.add(key);
    }

    hasCompleted(key: string): boolean {
        return this.done.has(key);
    }
}

/**
 * How long to give an ALREADY-ARRIVING token before spending a request without
 * it, and how often to look.
 *
 * Deliberately far shorter than POT_TOGGLE_TIMEOUT_MS below: this wait provokes
 * nothing and touches nothing, it only declines to race a token that is already
 * on its way. Measured on live traces, a token that arrives at all arrives
 * within ~100ms of our first request on a warm page (+92ms, +94ms, +95ms, +97ms
 * across four sessions); the slower cases are cold pages where the player has
 * not yet fetched its own track, and those are what the ceiling exists for.
 *
 * The ceiling is the whole safety argument, and it is why this is not the
 * outage of 9cf1f39. That implementation waited 15 seconds AND reported
 * 'no-pot' when the sniff missed, so a missed token stopped subtitles. Here the
 * wait is under a second and expiring it changes nothing about what happens
 * next: the request goes out with whatever is known, exactly as today.
 */
export const POT_WAIT_MS = 900;
export const POT_WAIT_POLL_MS = 60;

/** What awaitPot needs; injected so it is testable on a fake clock. */
export interface AwaitPotDeps {
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    signal?: AbortSignal;
}

/**
 * Give a token a brief chance to show up, then answer with whatever there is.
 *
 * Why wait at all, when the rule of this module is that nothing may block:
 * because a tokenless request to /api/timedtext does not have poor odds, it has
 * none. Across four live traces, 158 requests went out without a token and 0
 * of them returned subtitles, while 44 went out with one and 39 loaded. Sending
 * the doomed request first and looking for the token afterwards spends a
 * guaranteed failure — and, because an empty answer is retried, spends it up to
 * three times per track. Every 429 in those traces landed on such a request.
 *
 * So this is a bounded pause, not a precondition. It NEVER throws, never waits
 * past POT_WAIT_MS, and returns null rather than failing the track — the caller
 * then proceeds exactly as it does today. An abort ends it at once.
 */
export async function awaitPot(
    lookup: () => string | null,
    deps: AwaitPotDeps = {},
): Promise<string | null> {
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const { signal } = deps;

    // The overwhelmingly common case on a warm page: already in hand, no wait.
    const immediate = lookup();
    if (immediate) return immediate;
    if (signal?.aborted) return null;

    const deadline = now() + POT_WAIT_MS;
    while (now() < deadline) {
        await sleep(POT_WAIT_POLL_MS, signal);
        if (signal?.aborted) return null;
        const found = lookup();
        if (found) return found;
    }
    return null;
}

/**
 * How long to give the player to mint a token AFTER our own request already
 * came back empty, which is also how long the CC flash may last.
 *
 * Short by design, for two reasons that point the same way: the viewer is
 * staring at an empty panel, and during the wait they are seeing YouTube's own
 * captions on a video they never asked to have captions on. This is an
 * optimisation on a retry, never a precondition for one.
 */
export const POT_TOGGLE_TIMEOUT_MS = 4000;
export const POT_POLL_MS = 150;

/**
 * How a mint attempt ended.
 *
 *  - 'toggled'        the control was actually clicked and the budget waited
 *                     out (with or without a token at the end of it) — the
 *                     only outcome where the player was genuinely asked;
 *  - 'recycled-cc'    captions read as ON while the player had fetched no
 *                     track, so they were cycled off and back on to provoke
 *                     one; the viewer's setting ends where it started;
 *  - 'cc-already-on'  captions were already on AND the player had fetched its
 *                     track, so clicking would turn them OFF and mint nothing;
 *  - 'ad'             an ad was on screen, so the token would be the ad's;
 *  - 'no-button'      the player chrome had not rendered its control yet.
 *
 * The last three are early exits: they cost nothing and claim nothing, which
 * is also why a trace cannot tell them apart by timing alone.
 */
export type MintReason = 'toggled' | 'recycled-cc' | 'cc-already-on' | 'ad' | 'no-button';

/** What the minting routine needs from the page it runs on. */
export interface MintDeps {
    /** The CC control to click, or null if the player chrome has not rendered. */
    ccToggle: () => HTMLElement | null;
    /** The token already held for this video, if any. */
    knownPot: (videoId: string) => string | null;
    /** The video the address currently points at — not necessarily the one asked for. */
    currentUrlVideoId: () => string | null;
    /**
     * Whether an ad is on screen. Optional: a caller that does not supply it
     * (and Rezka, which has no ads) behaves exactly as before.
     */
    isAdPlaying?: () => boolean;
    /**
     * Has the PLAYER itself fetched a caption track for this video?
     *
     * Only consulted when the CC control reads as on, to check that exit's
     * premise rather than assume it. `false` means the control is describing a
     * preference and not a fetch, and the toggle is worth spending.
     *
     * Optional, and `undefined` is not `false`: a caller that cannot answer
     * (Rezka) keeps the old behaviour exactly.
     */
    playerFetchedCaptions?: (videoId: string) => boolean;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Diagnostics only; nothing here reaches the viewer. */
    log?: (message: string) => void;
    /**
     * Why the routine stopped. Diagnostics only — the token is still the
     * return value, and nothing here changes what the routine does.
     *
     * It exists because the three non-toggling exits are indistinguishable
     * from outside: on a live trace, four mints each finished a millisecond
     * after starting with no token, which says an early exit was taken but not
     * which one — and they point at three different fixes.
     */
    onOutcome?: (reason: MintReason) => void;
    now?: () => number;
}

/**
 * Briefly turn the site's own captions on so the player signs a request we can
 * read the token out of, then turn them back off.
 *
 * Extracted from page-script.ts so it can be tested: it runs in the MAIN world
 * at document_start, inside a closure a test cannot reach. Everything it used
 * to read from that closure now arrives in `deps`, so the routine itself makes
 * no assumption about the page — which is also what lets a test drive it with
 * a plain button and a fake clock.
 */
export async function doMintPotViaCcToggle(
    videoId: string,
    signal: AbortSignal,
    once: SharedOnce<string | null>,
    deps: MintDeps,
): Promise<string | null> {
    const now = deps.now ?? (() => Date.now());
    // NOT the "is it offerable" helper: that one skips a control whose
    // aria-label says captions are "unavailable", which is right for its job
    // (don't offer a toggle that does nothing) and wrong here. Measured live:
    // on a watch page YouTube labels the button "Subtitles/closed captions
    // unavailable" while the player response DOES list caption tracks, and
    // clicking it anyway flips aria-pressed and produces a pot-signed request.
    // The label describes the track not being loaded yet, not the video
    // lacking captions.
    const report = (reason: MintReason): void => {
        try {
            deps.onOutcome?.(reason);
        } catch {
            // A diagnostic listener must never change what the routine does.
        }
    };
    const btn = deps.ccToggle();
    // No control yet — the player chrome renders late and this runs seconds
    // into the page. Claiming the attempt HERE would burn the one mint this
    // video gets on a button that had not appeared, and every later track and
    // every "Search again" would then return null without ever clicking the
    // control that exists by then. Leave the video unclaimed so the next
    // attempt can try again.
    if (!btn) {
        report('no-button');
        return null;
    }
    // The state we found the viewer's control in. Everything below restores to
    // THIS, whichever way round it was — the routine borrows the control, it
    // does not get to decide where it ends up.
    const wasOn = btn.getAttribute('aria-pressed') === 'true';

    // Captions already on. The premise of skipping is that the player has
    // therefore fetched its caption track and a token exists that we merely
    // missed sniffing — true on a warm page, and then a toggle would only turn
    // the viewer's captions OFF and mint nothing.
    //
    // Measured false on trace wjZofJX0v4M: captions read as on, the player had
    // fetched no timedtext at all, and this exit fired four times on a video
    // with 21 caption tracks while the panel reported none. So check the
    // premise where the caller can answer it. When the player really has not
    // asked, the control is describing a preference rather than a fetch, and
    // the toggle is worth spending — see the recycle below.
    const ccIsStale = wasOn && deps.playerFetchedCaptions?.(videoId) === false;
    if (wasOn && !ccIsStale) {
        report('cc-already-on');
        return deps.knownPot(videoId);
    }
    // An ad is playing: the request our click would provoke is the AD's, signed
    // for a different `v=`, which PotStore files under that id and never serves
    // for this video. So the flash costs the viewer captions on an ad they did
    // not ask for and teaches us nothing.
    //
    // Above the recycle as well as the plain toggle: an ad's caption track is
    // the wrong track either way round, so provoking a re-fetch during one buys
    // exactly as little.
    //
    // Left UNCLAIMED on purpose — an ad is "come back later", not an answer.
    // Claiming it here would spend the one mint this video gets on a pre-roll,
    // and the real opportunity seconds later would be refused. That is the same
    // trap as the missing-button branch above.
    if (deps.isAdPlaying?.()) {
        deps.log?.('ad playing — not minting; the token would be the ad’s');
        report('ad');
        return deps.knownPot(videoId);
    }

    // Claimed only now that a real toggle is about to happen — an attempt that
    // bailed above (no control rendered yet, an ad on screen) stays retryable.
    once.complete(videoId);
    report(ccIsStale ? 'recycled-cc' : 'toggled');

    if (ccIsStale) {
        // Off and straight back on. The player treats the second click as a
        // fresh request for the track, which is the signed request we are
        // after; a single click would just leave the viewer's captions off.
        deps.log?.('captions read as on but nothing was fetched — recycling them to mint');
        btn.click();
        btn.click();
    } else {
        deps.log?.('no pot — briefly enabling native captions to mint one');
        btn.click();
    }
    try {
        const deadline = now() + POT_TOGGLE_TIMEOUT_MS;
        while (now() < deadline) {
            if (signal.aborted) break;
            const found = deps.knownPot(videoId);
            if (found) return found;
            await deps.sleep(POT_POLL_MS, signal);
        }
        return deps.knownPot(videoId);
    } finally {
        // Put the control back the way it was found, and only while it is still
        // that video's control. Re-querying the DOM here would, after a
        // navigation, hand back the NEW video's button — and YouTube persists
        // the CC preference across videos, so we would be changing captions on
        // a video we never touched.
        //
        // Compared against `wasOn` rather than assuming we turned them on: the
        // recycle path starts from ON and must end there too. Reading the
        // control's state and clicking only on a mismatch means a page that
        // moved it underneath us (the player restoring its own preference) is
        // left alone rather than clicked back into the wrong state.
        if (deps.currentUrlVideoId() === videoId
            && btn.isConnected
            && (btn.getAttribute('aria-pressed') === 'true') !== wasOn) {
            btn.click();
            deps.log?.(wasOn ? 'native captions -> On (restored)' : 'native captions -> Off (restored)');
        }
    }
}
