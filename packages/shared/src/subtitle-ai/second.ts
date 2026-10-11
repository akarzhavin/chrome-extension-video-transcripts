// The second subtitle track the server genders "I" and "you" from (english
// repo, spec 023 FR-011b): a track in a gendered language a human, or the
// site's machine translation, already gendered. The server checks the same
// rank and coverage again; this side only decides which one to fetch and send.

import { genderMarked, secondRank } from '../languages';
import type { Subtitle } from '../types';
import { prepareTrack, type PreparedTrack, type WireCue } from './track';

/** Share of the spoken source cues the alignment must cover (server `SecondCoverage`). */
export const SECOND_COVERAGE = 0.8;
// Server's MaxSilentTag and sound-tag shape: such cues are not dialogue.
const MAX_SILENT_TAG = 40;
const SOUND_TAG = /^(\[[^\]]*\]|\([^)]*\)|[♪♫\s]+)$/u;

/** A track the site offers, in the site's order; loaded only when its rank is tried. */
export interface SecondCandidate {
    /** Base language code, e.g. 'es'. */
    lang: string;
    /** 'manual': made by people; 'auto': the site's machine translation. */
    kind: 'manual' | 'auto';
    load(): Promise<Subtitle[]>;
}

const silent = (text: string): boolean => {
    const t = text.trim();
    return t === '' || ([...t].length <= MAX_SILENT_TAG && SOUND_TAG.test(t));
};

/**
 * Pairs each source cue with second-track cues by the greatest time overlap,
 * never by index: translators cut lines differently. A second cue goes to the
 * source cue it overlaps most; a source cue left without one takes the second
 * cue it overlaps most. Mirrors the server's Align.
 */
export function align(src: readonly WireCue[], second: readonly WireCue[]): number[][] {
    const out: number[][] = src.map(() => []);
    const best = src.map(() => -1);
    const bestOv = src.map(() => 0);
    const longest = src.reduce((m, c) => Math.max(m, c.end_ms - c.start_ms), 0);
    // First source cue starting at or after ms; starts are sorted.
    const firstFrom = (ms: number): number => {
        let lo = 0;
        let hi = src.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (src[mid].start_ms < ms) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    second.forEach((c, j) => {
        let at = -1;
        let top = 0;
        for (let i = firstFrom(c.start_ms - longest); i < src.length && src[i].start_ms < c.end_ms; i++) {
            const ov = Math.min(src[i].end_ms, c.end_ms) - Math.max(src[i].start_ms, c.start_ms);
            if (ov > top) {
                at = i;
                top = ov;
            }
            if (ov > bestOv[i]) {
                best[i] = j;
                bestOv[i] = ov;
            }
        }
        if (at >= 0) out[at].push(j);
    });
    out.forEach((js, i) => {
        if (js.length === 0 && best[i] >= 0) js.push(best[i]);
    });
    return out;
}

/** Share of the spoken source cues the alignment gives a line. */
export function coverage(src: readonly WireCue[], al: number[][]): number {
    let spoken = 0;
    let got = 0;
    src.forEach((c, i) => {
        if (silent(c.text)) return;
        spoken++;
        if (al[i].length > 0) got++;
    });
    return spoken === 0 ? 0 : got / spoken;
}

/**
 * The second track for a translation of `src` into `target`, or null: manual
 * tracks before machine ones, then by language rank; within a rank only
 * tracks covering SECOND_COVERAGE count, the fuller first, then the site's
 * order. Only the best rank with a usable track is fetched.
 */
export async function pickSecond(target: string, src: PreparedTrack, candidates: readonly SecondCandidate[]): Promise<PreparedTrack | null> {
    if (!genderMarked(target)) return null;
    const groups = new Map<number, { c: SecondCandidate; order: number }[]>();
    candidates.forEach((c, order) => {
        const rank = secondRank(target, c.lang);
        if (rank === 0) return;
        const key = (c.kind === 'manual' ? 0 : 10) + rank;
        groups.set(key, [...(groups.get(key) ?? []), { c, order }]);
    });
    for (const key of [...groups.keys()].sort((a, b) => a - b)) {
        const tried = await Promise.all(
            groups.get(key)!.map(async ({ c, order }) => {
                let subs: Subtitle[];
                try {
                    subs = await c.load();
                } catch {
                    return null;
                }
                const p = prepareTrack(subs, c.lang, src.site);
                if ('error' in p) return null;
                return { p, order, cover: coverage(src.cues, align(src.cues, p.cues)) };
            }),
        );
        const usable = tried
            .filter((t): t is NonNullable<typeof t> => !!t && t.cover >= SECOND_COVERAGE)
            .sort((a, b) => b.cover - a.cover || a.order - b.order);
        if (usable.length > 0) return usable[0].p;
    }
    return null;
}
