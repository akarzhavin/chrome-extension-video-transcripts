import { Subtitle } from './types';

/**
 * Which cues of the translation track belong under each cue of the main one.
 *
 * Returns one array per main cue, index-aligned with `main`: the secondary
 * cues assigned to it, in time order. Every secondary cue lands in AT MOST one
 * of those arrays — the main cue it shares the most time with — and a cue
 * that touches no main cue at all is left out, as before.
 *
 * The rule used to be "any overlap": every secondary cue whose span crossed
 * the main cue's by even a millisecond was attached to it. That is correct
 * only when both tracks share one segmentation, which YouTube's auto-translate
 * guarantees (it is generated from the original's timing) and human-made
 * tracks do not. Netflix's Russian track is cut by its own translator and sits
 * a few hundred ms off the English one, so each Russian cue straddled two
 * English cues and was attached to both: a line showed up under the reply
 * before its own, then again under its own, joined with " | ". Measured on
 * 70094483 the sidebar carried three Russian fragments per English line.
 *
 * Best-overlap is the fix that cannot lose a line. A threshold ("keep it if
 * ≥50% of it overlaps") drops a cue that is shifted far enough to clear the
 * bar with nobody; assigning each cue to its single best partner keeps it
 * somewhere no matter how far it drifts, and drops the duplicate by
 * construction. Where the two tracks DO share a segmentation nothing changes:
 * a cue that overlaps one main cue only is assigned to that cue.
 *
 * `main` is expected in start order — the same assumption the binary search
 * that picks the current cue already makes. `secondary` is walked in start
 * order too, sorted here so an out-of-order file still gets a monotone sweep.
 */
export function pairSecondaryToMain(main: Subtitle[], secondary: Subtitle[]): Subtitle[][] {
    const paired: Subtitle[][] = main.map(() => []);
    if (main.length === 0 || secondary.length === 0) return paired;

    const order = secondary
        .map((_, i) => i)
        .sort((a, b) => secondary[a].startTime - secondary[b].startTime);

    // The first main cue that may still overlap the current secondary one.
    // Advances only past cues that ended before this secondary cue starts;
    // since the secondary cues come in start order, nothing skipped here can
    // overlap a later one either. Cues after `from` that have already ended
    // are simply scanned and score zero.
    let from = 0;
    for (const si of order) {
        const s = secondary[si];
        while (from < main.length && main[from].endTime <= s.startTime) from++;

        let best = -1;
        let bestOverlap = 0;
        for (let j = from; j < main.length && main[j].startTime < s.endTime; j++) {
            const m = main[j];
            const overlap = Math.min(m.endTime, s.endTime) - Math.max(m.startTime, s.startTime);
            // Strict: on an exact tie the earlier main cue keeps it, so a cue
            // split evenly across two lines reads with the first, not the second.
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                best = j;
            }
        }
        if (best >= 0) paired[best].push(s);
    }
    return paired;
}
