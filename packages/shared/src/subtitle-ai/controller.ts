// Content-script half of server-side subtitle translation:
// an AI track in the native language, filled part by part just ahead of
// playback, so a film is paid for as it is watched rather than up front.

import type { AppState } from '../AppState';
import { msg } from '../i18n';
import { genderMarked, labelForLanguage } from '../languages';
import type { Track } from '../types';
import { pickSecond, type SecondCandidate } from './second';
import { prepareRefusal, prepareTrack, type PreparedTrack } from './track';
import type { PartCode, PartReply, StoreReply } from './worker';

export type AiStatus =
    | 'working'
    | 'ready'
    | 'auth'
    | 'quota'
    | 'rate'
    | 'limit'
    | 'too_long'
    | 'unavailable'
    | 'unsupported';

/** The status line's text for each status. */
export function aiStatusText(s: AiStatus): string {
    const text: Record<AiStatus, string> = {
        working: msg('ytAiStatusWorking', 'Translating…'),
        ready: msg('ytAiStatusReady', 'AI translation is on'),
        auth: msg('ytAiStatusAuth', 'Sign in again to use AI translation'),
        quota: msg('ytAiStatusQuota', 'The AI limit is reached'),
        rate: msg('ytAiStatusRate', 'Too many requests — try again in a minute'),
        limit: msg('ytAiStatusLimit', 'Too many new videos today — try again later'),
        too_long: msg('ytAiStatusTooLong', 'These subtitles are too long for AI translation'),
        unavailable: msg('ytAiStatusUnavailable', 'AI translation is temporarily unavailable'),
        unsupported: msg('ytAiStatusUnsupported', 'AI translation does not cover this language pair'),
    };
    return text[s];
}

/** The page and the browser, as the AI translation sees them. */
export interface AiHost {
    state: AppState;
    site: string;
    refresh(): void;
    /** Repaint only the AI lines that changed; refresh() when absent. */
    refreshLines?(): void;
    /** null: no AI translation running. */
    setStatus?(s: AiStatus | null): void;
    /** A message to the service worker. */
    send(msg: object): Promise<unknown>;
    /** Playback position, seconds. */
    currentTime(): number;
    later(fn: () => void, ms: number): void;
    /** The site's other subtitle tracks, the gender hint's candidates; absent: none. */
    secondTracks?(): SecondCandidate[];
    /** Wall clock, ms; Date.now when absent. */
    now?(): number;
}

// The grid, windows and timings ship in lingogram-limits.json, admin-edited and
// released together with the server, which must cut the track the same way.
const L = __LIMIT_SUBTITLE__;
// The backend's grid: cells shared by every viewer.
const PART = L.SUBTITLE_PART_SIZE;
const FIRST_PART = L.SUBTITLE_FIRST_PART;
const SHORT_TRACK = L.SUBTITLE_SHORT_TRACK;
// The cell being watched and the next ones; the rest waits for playback.
const AHEAD = L.SUBTITLE_READ_AHEAD;
// The dynamic window: how many cells one request covers. It grows with
// playback watched since the start or the last seek, so a video opened for a
// few seconds is not translated ahead; the server takes only these three.
const MIN_WINDOW = L.SUBTITLE_WINDOW_MIN;
const MID_WINDOW = L.SUBTITLE_WINDOW_MID;
const MAX_WINDOW = L.SUBTITLE_WINDOW_MAX;
const WINDOW_MID_AFTER_S = L.SUBTITLE_WINDOW_MID_AFTER_S;
const WINDOW_MAX_AFTER_S = L.SUBTITLE_WINDOW_MAX_AFTER_S;
const IDLE_MS = L.SUBTITLE_IDLE_MS;
// A 503 is retried on a timer only when the server says it passes soon, and
// only a few times per part; otherwise the part waits for the viewer.
const MAX_RETRY_AFTER_MS = L.SUBTITLE_RETRY_AFTER_CAP_S * 1000;
const MAX_RETRIES = L.SUBTITLE_MAX_RETRIES;
// The store rules refuse two tracks within this interval (lingogram-limits.json);
// the second track waits it out after the learning track, plus a margin.
const STORE_INTERVAL_MS = L.SUBTITLE_MIN_INTERVAL_S * 1000 + 1000;

export const AI_SUFFIX = ' · AI';

// The backend's grid as [from, to) cue ranges.
function splitParts(n: number): [number, number][] {
    if (n <= SHORT_TRACK) return [[0, n]];
    const out: [number, number][] = [[0, FIRST_PART]];
    for (let from = FIRST_PART; from < n; from += PART) out.push([from, Math.min(n, from + PART)]);
    return out;
}

// Every refusal, from the server or the track store, in one table:
// the status the viewer sees, and what follows. 'stop' ends translation of
// this video; 'wait' leaves the part until a viewer event (seek, new video,
// return to Dual); 'retry' follows the Retry-After rule above. track_unknown
// is no refusal: the track is stored and the part asked again.
type Refusal = Exclude<PartCode, 'track_unknown'> | 'store_refused' | 'store_too_long' | 'store_auth' | 'store_network';
const REFUSALS: Record<Refusal, { status: AiStatus; then: 'stop' | 'wait' | 'retry' }> = {
    auth: { status: 'auth', then: 'stop' },
    quota: { status: 'quota', then: 'stop' },
    rate_limited: { status: 'rate', then: 'wait' },
    invalid: { status: 'unavailable', then: 'stop' },
    quarantined: { status: 'unavailable', then: 'stop' },
    unavailable: { status: 'unavailable', then: 'retry' },
    // Still unknown after storing: the store refused it (a write limit).
    store_refused: { status: 'limit', then: 'stop' },
    store_too_long: { status: 'too_long', then: 'stop' },
    store_auth: { status: 'auth', then: 'stop' },
    store_network: { status: 'unavailable', then: 'wait' },
};

export class AiTranslator {
    source: Track | null = null;
    // Null before start and once stopped: nothing more is asked for.
    private track: PreparedTrack | null = null;
    private parts: [number, number][] = [];
    private ai: Track | null = null;
    private done = new Set<number>();
    // Parts the server could not translate now, or not all of yet; asked again on a viewer event.
    private waitingForViewer = new Set<number>();
    private retries = new Map<number, number>();
    // Bumped by a viewer event: a timer set before it no longer ticks.
    private generation = 0;
    private stored = false;
    private busy = false;
    // Outside Dual: no new requests, the lines already in stay.
    private paused = false;
    // Playback position (s) of the start or the last viewer event.
    private watchedFrom = 0;
    // The cells [first, end) of the request in flight or waiting on a retry.
    private asking: [number, number] = [0, 0];
    // The gender hint (T113): named in every part request once picked.
    private second: PreparedTrack | null = null;
    private secondStore: 'no' | 'storing' | 'tried' = 'no';
    private lastStoreAt: number | null = null;

    constructor(
        private host: AiHost,
        readonly learning: string,
        readonly native: string,
    ) {}

    get aiName(): string {
        return labelForLanguage(this.native) + AI_SUFFIX;
    }

    start(source: Track): void {
        this.source = source;
        const prepared = prepareTrack(source.subtitles, this.learning, this.host.site);
        const refused = this.learning === this.native ? null : prepareRefusal(prepared, this.learning);
        if (refused) void this.host.send({ action: 'LIMIT_REFUSED', limit: refused }).catch(() => undefined);
        if ('error' in prepared || this.learning === this.native) {
            const unsupported = this.learning === this.native || ('error' in prepared && prepared.error === 'unsupported');
            this.host.setStatus?.(unsupported ? 'unsupported' : 'unavailable');
            return;
        }
        this.track = prepared;
        this.parts = splitParts(prepared.cues.length);
        if (genderMarked(this.native) && this.host.secondTracks) void this.findSecond(prepared);
        this.watchedFrom = this.host.currentTime();
        const state = this.host.state;
        state.preferredSecondaryName = this.aiName;
        const sent = new Set(prepared.index);
        state.addTrack(this.aiName, source.subtitles.map((s, i) => ({
            startTime: s.startTime,
            endTime: s.endTime,
            text: '',
            ...(!sent.has(i) && s.text.trim() ? { skipped: true } : {}),
        })));
        this.ai = state.tracks.find((t) => t.name === this.aiName) ?? null;
        this.host.setStatus?.('working');
        this.host.refresh();
        void this.tick();
    }

    setPaused(paused: boolean): void {
        if (paused === this.paused) return;
        this.paused = paused;
        if (!paused) this.viewerEvent(); // a return to Dual
    }

    /** A seek, or a return to Dual: ask again for what the server could not translate. */
    viewerEvent(): void {
        if (!this.track) return;
        this.watchedFrom = this.host.currentTime();
        this.generation++;
        this.waitingForViewer.clear();
        this.retries.clear();
        void this.tick();
    }

    private later(ms: number): void {
        const g = this.generation;
        this.host.later(() => {
            if (g === this.generation) void this.tick();
        }, ms);
    }

    stop(): void {
        this.track = null;
        const state = this.host.state;
        if (state.preferredSecondaryName === this.aiName) state.preferredSecondaryName = undefined;
        state.removeTrack(this.aiName);
        this.host.refresh();
    }

    // Picked while the first parts are asked; they go without it.
    private async findSecond(prepared: PreparedTrack): Promise<void> {
        try {
            const second = await pickSecond(this.native, prepared, this.host.secondTracks!());
            if (this.track === prepared) this.second = second;
        } catch {
            // No hint: the server falls back to the text, a guess, neutral phrasing.
        }
    }

    private now(): number {
        return this.host.now ? this.host.now() : Date.now();
    }

    // The server does not hold the named second track: store it once, after
    // the store interval; still unknown after that, stop naming it.
    private secondUnknown(): void {
        if (!this.second || this.secondStore === 'storing') return;
        if (this.secondStore === 'tried') {
            this.second = null;
            return;
        }
        this.secondStore = 'storing';
        const wait = this.lastStoreAt === null ? 0 : this.lastStoreAt + STORE_INTERVAL_MS - this.now();
        if (wait > 0) this.host.later(() => void this.storeSecond(), wait);
        else void this.storeSecond();
    }

    private async storeSecond(): Promise<void> {
        const s = this.second;
        if (!s || !this.track) return;
        let reply: StoreReply;
        try {
            reply = (await this.host.send({
                action: 'SUBTITLE_AI_STORE',
                track: { fingerprint: s.fingerprint, sourceLang: s.sourceLang, site: s.site, durationMs: s.durationMs, cues: s.cues },
            })) as StoreReply;
        } catch {
            reply = { ok: false, reason: 'network' };
        }
        if (reply.ok) this.lastStoreAt = this.now();
        this.secondStore = !reply.ok && reply.reason === 'network' ? 'no' : 'tried';
    }

    private nextPart(): number | null {
        const ms = this.host.currentTime() * 1000;
        const cues = this.track!.cues;
        let k = cues.findIndex((c) => c.end_ms >= ms);
        if (k === -1) k = cues.length - 1;
        const cur = this.parts.findIndex(([from, to]) => k >= from && k < to);
        for (let p = cur; p < Math.min(this.parts.length, cur + AHEAD); p++) {
            if (!this.done.has(p) && !this.waitingForViewer.has(p)) return p;
        }
        return null;
    }

    private window(): number {
        const watched = this.host.currentTime() - this.watchedFrom;
        if (watched >= WINDOW_MAX_AFTER_S) return MAX_WINDOW;
        return watched >= WINDOW_MID_AFTER_S ? MID_WINDOW : MIN_WINDOW;
    }

    // The cells from p on that one request covers: up to the window, while
    // they are neither done nor waiting.
    private cellsFrom(p: number, window: number): [number, number] {
        let end = p + 1;
        while (end < Math.min(this.parts.length, p + window) && !this.done.has(end) && !this.waitingForViewer.has(end)) end++;
        return [p, end];
    }

    // An error stop is shown, never silent: the viewer sees the status;
    // the AI track and the lines already in it stay.
    private async tick(): Promise<void> {
        try {
            await this.step();
        } catch {
            this.busy = false;
            this.halt('unavailable');
        }
    }

    private async step(): Promise<void> {
        if (!this.track || this.busy || this.paused) return;
        const p = this.nextPart();
        if (p === null) {
            this.later(IDLE_MS);
            return;
        }
        const window = this.window();
        this.asking = this.cellsFrom(p, window);
        const [from, to] = this.cellRange(this.asking);
        this.busy = true;
        this.mark(from, to, true);
        let reply: PartReply;
        try {
            reply = (await this.host.send({
                action: 'SUBTITLE_AI_PART',
                part: { fingerprint: this.track.fingerprint, lang: this.native, from, to, window, ...(this.second ? { second: this.second.fingerprint } : {}) },
            })) as PartReply;
        } catch {
            reply = { ok: false, code: 'unavailable' };
        }
        this.busy = false;
        if (!this.track) return;

        if (reply.ok) {
            if (reply.secondUnknown) this.secondUnknown();
            const pending = reply.pending ?? [];
            this.fill(reply.from, reply.lines, reply.skipped ?? [], pending);
            // A cell not all ready: its pending cues stay marked, and it
            // is asked again on a viewer event, like a cell unavailable now.
            for (let c = this.asking[0]; c < this.asking[1]; c++) {
                const [cf, ct] = this.parts[c];
                if (pending.some((i) => i >= cf && i < ct)) this.waitingForViewer.add(c);
                else this.done.add(c);
            }
            this.host.setStatus?.('ready');
            void this.tick();
            return;
        }
        if (reply.code === 'track_unknown') {
            if (this.stored) return this.refused('store_refused', p);
            this.stored = true;
            return await this.store(p);
        }
        this.refused(reply.code in REFUSALS ? reply.code : 'unavailable', p, reply.retryAfterMs);
    }

    private refused(code: Refusal, p: number, retryAfterMs?: number): void {
        const { status, then } = REFUSALS[code];
        if (then === 'stop') return this.halt(status);
        if (then === 'retry') return this.unavailableNow(p, retryAfterMs);
        this.waitForViewer(status);
    }

    // Retry a short Retry-After a few times; else the part waits for
    // the viewer (seek, new video, return to Dual), with no timer retry.
    private unavailableNow(p: number, retryAfterMs?: number): void {
        const n = this.retries.get(p) ?? 0;
        if (retryAfterMs !== undefined && retryAfterMs <= MAX_RETRY_AFTER_MS && n < MAX_RETRIES) {
            this.retries.set(p, n + 1);
            this.later(retryAfterMs);
            return;
        }
        this.waitForViewer('unavailable');
    }

    // Every cell of the request waits for the viewer.
    private waitForViewer(status: AiStatus): void {
        for (let c = this.asking[0]; c < this.asking[1]; c++) this.waitingForViewer.add(c);
        const [from, to] = this.cellRange(this.asking);
        this.mark(from, to, false);
        this.host.setStatus?.(status);
        void this.tick();
    }

    private async store(p: number): Promise<void> {
        const t = this.track!;
        let reply: StoreReply;
        try {
            reply = (await this.host.send({
                action: 'SUBTITLE_AI_STORE',
                track: { fingerprint: t.fingerprint, sourceLang: t.sourceLang, site: t.site, durationMs: t.durationMs, cues: t.cues },
            })) as StoreReply;
        } catch {
            reply = { ok: false, reason: 'network' };
        }
        if (!this.track) return;
        if (reply.ok) this.lastStoreAt = this.now();
        if (!reply.ok && reply.reason === 'network') {
            // Nothing was stored: store again when the viewer comes back to it.
            this.stored = false;
            return this.refused('store_network', p);
        }
        if (!reply.ok && reply.reason !== 'refused') return this.refused(`store_${reply.reason}`, p);
        // Stored, or refused because someone else stored it first: ask once more.
        void this.tick();
    }

    private fill(from: number, lines: string[], skipped: number[], pending: number[]): void {
        if (!this.ai) return;
        const index = this.track!.index;
        const dropped = new Set(skipped);
        const waiting = new Set(pending);
        lines.forEach((line, k) => {
            const cue = this.ai!.subtitles[index[from + k]];
            if (cue && waiting.has(from + k)) {
                cue.pending = true;
            } else if (cue) {
                cue.text = dropped.has(from + k) ? '' : line;
                cue.pending = false;
                if (dropped.has(from + k)) cue.skipped = true;
            }
        });
        this.refreshLines();
    }

    // The cue range [from, to) of cells [first, end).
    private cellRange([first, end]: [number, number]): [number, number] {
        return [this.parts[first][0], this.parts[end - 1][1]];
    }

    // Tells "being translated" apart from "not asked for yet"; a part waiting
    // on a retry stays marked, it is still on its way.
    private mark(from: number, to: number, on: boolean): void {
        if (!this.ai) return;
        const index = this.track!.index;
        let changed = false;
        for (let k = from; k < to; k++) {
            const cue = this.ai.subtitles[index[k]];
            if (cue && !cue.text && !!cue.pending !== on) {
                cue.pending = on;
                changed = true;
            }
        }
        if (changed) this.refreshLines();
    }

    // Lines changed, not the track list: the panel patches those rows only.
    private refreshLines(): void {
        if (this.host.refreshLines) this.host.refreshLines();
        else this.host.refresh();
    }

    private halt(status: AiStatus): void {
        if (this.track) this.mark(0, this.track.cues.length, false);
        this.track = null;
        this.host.setStatus?.(status);
    }
}
