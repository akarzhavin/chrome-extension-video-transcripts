// Content-script half of server-side subtitle translation:
// an AI track in the native language, filled part by part just ahead of
// playback, so a film is paid for as it is watched rather than up front.

import type { AppState } from '../AppState';
import { labelForLanguage } from '../languages';
import type { Track } from '../types';
import { prepareTrack, type PreparedTrack } from './track';
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
}

// The backend's grid: a short track is one part; else a short first part (the
// first lines come fast), then parts of 100.
const PART = 100;
const FIRST_PART = 20;
const SHORT_TRACK = 20;
// The part being watched and the next one; the rest waits for playback.
const AHEAD = 2;
const IDLE_MS = 3000;
// A 503 is retried on a timer only when the server says it passes soon, and
// only a few times per part; otherwise the part waits for the viewer.
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_RETRIES = 3;

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
        if ('error' in prepared || this.learning === this.native) {
            const unsupported = this.learning === this.native || ('error' in prepared && prepared.error === 'unsupported');
            this.host.setStatus?.(unsupported ? 'unsupported' : 'unavailable');
            return;
        }
        this.track = prepared;
        this.parts = splitParts(prepared.cues.length);
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
        const [from, to] = this.parts[p];
        this.busy = true;
        this.markPart(p, true);
        let reply: PartReply;
        try {
            reply = (await this.host.send({
                action: 'SUBTITLE_AI_PART',
                part: { fingerprint: this.track.fingerprint, lang: this.native, from, to },
            })) as PartReply;
        } catch {
            reply = { ok: false, code: 'unavailable' };
        }
        this.busy = false;
        if (!this.track) return;

        if (reply.ok) {
            const pending = reply.pending ?? [];
            this.fill(reply.from, reply.lines, reply.skipped ?? [], pending);
            // A part not all ready: its pending cues stay marked, and it
            // is asked again on a viewer event, like a part unavailable now.
            if (pending.length) this.waitingForViewer.add(p);
            else this.done.add(p);
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
        this.waitForViewer(p, status);
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
        this.waitForViewer(p, 'unavailable');
    }

    private waitForViewer(p: number, status: AiStatus): void {
        this.waitingForViewer.add(p);
        this.markPart(p, false);
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

    private markPart(p: number, on: boolean): void {
        const [from, to] = this.parts[p];
        this.mark(from, to, on);
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
