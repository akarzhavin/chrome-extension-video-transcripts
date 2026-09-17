// ── Collapsing duplicate timedtext requests ─────────────────────────────────
// Extracted from page-script.ts's closure so the keying rule is unit testable
// without a MAIN-world page — the same move pot.ts made, for the same reason.
//
// Duplicate requests for one track are routine: yt-navigate-finish fires
// several times per navigation, "Search again" re-sends the plan, and a prefs
// change re-runs it. Without collapsing them each duplicate is a fresh burst of
// up to MAX_ATTEMPTS requests against an endpoint that rate limits per client.

/**
 * One in-flight request per key, shared by every caller that asks for it.
 *
 * The KEY is the point. The obvious choice — the URL being fetched — is the one
 * thing about a repeated request that is guaranteed to differ: a timedtext URL
 * carries `ei=`, `signature=` and (when known) `pot=`, all re-minted per
 * navigation while the track being asked for is unchanged. Measured on a live
 * trace: across six sessions a URL-keyed map collapsed nothing at all, and
 * every url_resolved event reported changed=true.
 *
 * So callers key on what they are asking FOR, not on how they happen to be
 * asking: the request key the isolated world already assigns each track,
 * `<videoId>:<TrackLabel>` (see planTrackRequests). It names the video and the
 * track and nothing else, so two navigations to the same video produce the same
 * key and the second one waits on the first.
 *
 * Only concurrency is deduplicated, never results. A key is released the moment
 * its request settles — success or failure — because a finished track must stay
 * re-fetchable: that is what "Search again" is, and what the pot cascade does
 * immediately after its first attempt returns.
 */
export class InFlightFetches<T> {
    private readonly inFlight = new Map<string, Promise<T>>();

    /**
     * Run `task` under `key`, or hand back the run already in flight for it.
     *
     * `onReuse` is called instead of `task` when a run is reused. The diagnostic
     * trace needs it: without it a track appears to receive an answer having
     * asked for nothing, which reads as a bug in the recorder rather than as
     * deduplication doing its job.
     */
    run(key: string, task: () => Promise<T>, onReuse?: (key: string) => void): Promise<T> {
        const existing = this.inFlight.get(key);
        if (existing) {
            onReuse?.(key);
            return existing;
        }
        // finally, not then: a rejected request must release its key too, or
        // the track hands back the same failure forever and no retry can reach
        // the network.
        const p: Promise<T> = task().finally(() => {
            // Delete only THIS run's entry. An abandoned run (see clear())
            // settles whenever its abort finally propagates, which may be after
            // a replacement is already installed under the same key — an
            // unconditional delete would evict the live run and let the next
            // caller start a second concurrent request for the same track.
            if (this.inFlight.get(key) === p) this.inFlight.delete(key);
        });
        this.inFlight.set(key, p);
        return p;
    }

    /**
     * Forget every in-flight run, without cancelling anything.
     *
     * Called when the page navigates to a DIFFERENT video: those requests have
     * been aborted, and the new video must not be handed one of them while the
     * abort propagates. Two videos can share a track label, so under track
     * keying this is the difference between the new video fetching and the new
     * video silently inheriting the old one's abandoned failure.
     */
    clear(): void {
        this.inFlight.clear();
    }
}
