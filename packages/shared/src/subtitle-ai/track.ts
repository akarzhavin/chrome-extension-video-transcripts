// The track the extension hands to the Lingogram backend for translation
// (english repo, spec 023, contracts/firestore-subtitle-tracks.md).
//
// The backend refuses a whole track for one bad cue and never repairs one
// (repairing would change the fingerprint), so every cue it would refuse is
// left out here and `index` maps what was sent back to the site's cues.

import type { Subtitle } from '../types';
import { sha256 } from '../word-key';

// From english/infrastructure/lingogram-limits.json, injected at build time
// (T058); the backend holds the same numbers, and a drift shows up as `invalid_track`.
const LIMITS = __LIMIT_SUBTITLE__;
export const SUBTITLE_LANGS: readonly string[] = LIMITS.SUBTITLE_LANGS;
export const SUBTITLE_SITES: readonly string[] = LIMITS.SUBTITLE_SITES;
export const SUBTITLE_TTL_DAYS = LIMITS.SUBTITLE_TTL_DAYS;
const MAX_CUES = LIMITS.SUBTITLE_MAX_CUES;
const MAX_DURATION_MS = LIMITS.SUBTITLE_MAX_DURATION_MS;
const MAX_CUE_TEXT = LIMITS.SUBTITLE_MAX_CUE_TEXT;
const MIN_CUE_MS = LIMITS.SUBTITLE_MIN_CUE_MS;
const MAX_CHARS_PER_SEC = LIMITS.SUBTITLE_MAX_CHARS_PER_SEC;
// One cue may run fast (a short line said quickly); the whole track may not.
const MAX_CUE_CHARS_PER_SEC = LIMITS.SUBTITLE_MAX_CUE_CHARS_PER_SEC;

export interface WireCue {
    start_ms: number;
    end_ms: number;
    text: string;
}

export interface PreparedTrack {
    sourceLang: string;
    site: string;
    cues: WireCue[];
    /** index[k] is the site cue that wire cue k came from. */
    index: number[];
    durationMs: number;
    fingerprint: string;
}

export type PrepareError = 'unsupported' | 'empty' | 'too_long' | 'too_dense';

const MARKUP = /<\s*\/?\s*[A-Za-z][^>]*>/g;
// ASS/SSA override blocks ({\an8}, {\i1}) are markup too; the backend refuses them.
const ASS_OVERRIDE = /\{\\[^}]*\}/g;
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

function clean(text: string): string {
    return text
        .replace(ASS_OVERRIDE, '')
        .replace(MARKUP, '')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(INVISIBLE, '')
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFC');
}

const runes = (s: string): number => [...s].length;

export function prepareTrack(
    subs: readonly Subtitle[],
    sourceLang: string,
    site: string,
): PreparedTrack | { error: PrepareError } {
    if (!SUBTITLE_LANGS.includes(sourceLang) || !SUBTITLE_SITES.includes(site)) return { error: 'unsupported' };
    if (subs.some((s) => s.endTime * 1000 > MAX_DURATION_MS)) return { error: 'too_long' };

    const cues: WireCue[] = [];
    const index: number[] = [];
    let lastStart = -1;
    let chars = 0;
    let lastEnd = 0;
    for (let i = 0; i < subs.length && cues.length < MAX_CUES; i++) {
        const start_ms = Math.round(subs[i].startTime * 1000);
        const end_ms = Math.round(subs[i].endTime * 1000);
        const text = clean(subs[i].text);
        const n = runes(text);
        const dur = end_ms - start_ms;
        if (n === 0 || start_ms < 0 || start_ms < lastStart || dur < MIN_CUE_MS) continue;
        if (n > MAX_CUE_TEXT || n * 1000 > MAX_CUE_CHARS_PER_SEC * dur) continue;
        cues.push({ start_ms, end_ms, text });
        index.push(i);
        lastStart = start_ms;
        chars += n;
        lastEnd = Math.max(lastEnd, end_ms);
    }
    if (cues.length === 0) return { error: 'empty' };
    // The backend also checks the whole timeline: cues stacked on one second
    // each pass alone and still read faster than anyone can.
    if (chars * 1000 > MAX_CHARS_PER_SEC * (lastEnd - cues[0].start_ms)) return { error: 'too_dense' };
    return { sourceLang, site, cues, index, durationMs: lastEnd, fingerprint: fingerprint(sourceLang, cues) };
}

/** lowercase hex sha256 of `lang\n` + `start\tend\ttext\n` per cue (research R5). */
export function fingerprint(sourceLang: string, cues: readonly WireCue[]): string {
    let s = sourceLang + '\n';
    for (const c of cues) s += `${c.start_ms}\t${c.end_ms}\t${c.text}\n`;
    const digest = sha256(new TextEncoder().encode(s));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
