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

/** Remembers the token seen for each video id. */
export class PotStore {
    private byVideoId = new Map<string, string>();

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
        if (!this.byVideoId.has(videoId)) this.byVideoId.set(videoId, pot);
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
