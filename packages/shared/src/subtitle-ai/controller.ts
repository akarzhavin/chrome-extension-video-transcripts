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

export interface AiHost {
    state: AppState;
    site: string;
    refresh(): void;
    /** Repaint only the lines that changed; refresh() when absent. */
    refreshLines?(): void;
    /** A message to the service worker. */
    send(msg: object): Promise<unknown>;
    /** Playback position, seconds. */
    currentTime(): number;
    setStatus?(s: AiStatus): void;
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

// Every refusal, from the server or the track store, in one table:
// the status the viewer sees, and what follows. 'stop' ends translation of
// this video; 'wait' leaves the part until a viewer event (seek, new video,
// return to Dual); 'retry' follows the Retry-After rule above.
type Refusal = PartCode | 'store_refused' | 'store_too_long' | 'store_auth' | 'store_network';
const REFUSALS: Record<Exclude<Refusal, 'track_unknown'>, { status: AiStatus; then: 'stop' | 'wait' | 'retry' }> = {
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
    private track: PreparedTrack | null = null;
    private ai: Track | null = null;
    private done = new Set<number>();
    // Parts the server could not translate now; asked again on a viewer event.
    private unavailable = new Set<number>();
    private retries = new Map<number, number>();
    // Bumped by a viewer event: a timer set before it no longer ticks.
    private generation = 0;
    private stored = false;
    private busy = false;
    private stopped = false;
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
            this.stopped = true;
            return;
        }
        this.track = prepared;
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
        if (!this.track || this.stopped) return;
        this.generation++;
        this.unavailable.clear();
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
        this.stopped = true;
        const state = this.host.state;
        if (state.preferredSecondaryName === this.aiName) state.preferredSecondaryName = undefined;
        state.removeTrack(this.aiName);
        this.host.refresh();
    }

    private parts(): [number, number][] {
        const n = this.track!.cues.length;
        if (n <= SHORT_TRACK) return [[0, n]];
        const out: [number, number][] = [];
        out.push([0, FIRST_PART]);
        for (let from = FIRST_PART; from < n; from += PART) out.push([from, Math.min(n, from + PART)]);
        return out;
    }

    private nextPart(): number | null {
        const ms = this.host.currentTime() * 1000;
        const cues = this.track!.cues;
        let k = cues.findIndex((c) => c.end_ms >= ms);
        if (k === -1) k = cues.length - 1;
        const parts = this.parts();
        const cur = parts.findIndex(([from, to]) => k >= from && k < to);
        for (let p = cur; p < Math.min(parts.length, cur + AHEAD); p++) {
            if (!this.done.has(p) && !this.unavailable.has(p)) return p;
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
        if (this.stopped || this.busy || this.paused) return;
        const p = this.nextPart();
        if (p === null) {
            this.later(IDLE_MS);
            return;
        }
        const [from, to] = this.parts()[p];
        this.busy = true;
        this.mark(from, to, true);
        let reply: PartReply;
        try {
            reply = (await this.host.send({
                action: 'SUBTITLE_AI_PART',
                part: { fingerprint: this.track!.fingerprint, lang: this.native, from, to },
            })) as PartReply;
        } catch {
            reply = { ok: false, code: 'unavailable' };
        }
        this.busy = false;
        if (this.stopped) return;

        if (reply.ok) {
            const pending = reply.pending ?? [];
            this.fill(reply.from, reply.lines, reply.skipped ?? [], pending);
            // A part not all ready: its pending cues stay marked, and it
            // is asked again on a viewer event, like a part unavailable now.
            if (pending.length) this.unavailable.add(p);
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

    private refused(code: Exclude<Refusal, 'track_unknown'>, p: number, retryAfterMs?: number): void {
        const { status, then } = REFUSALS[code];
        if (then === 'stop') return this.halt(status);
        const [from, to] = this.parts()[p];
        if (then === 'retry') return this.unavailableNow(p, from, to, retryAfterMs);
        this.waitForViewer(p, from, to, status);
    }

    // Retry a short Retry-After a few times; else the part waits for
    // the viewer (seek, new video, return to Dual), with no timer retry.
    private unavailableNow(p: number, from: number, to: number, retryAfterMs?: number): void {
        const n = this.retries.get(p) ?? 0;
        if (retryAfterMs !== undefined && retryAfterMs <= MAX_RETRY_AFTER_MS && n < MAX_RETRIES) {
            this.retries.set(p, n + 1);
            this.later(retryAfterMs);
            return;
        }
        this.waitForViewer(p, from, to, 'unavailable');
    }

    private waitForViewer(p: number, from: number, to: number, status: AiStatus): void {
        this.unavailable.add(p);
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
        if (this.stopped) return;
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
        this.stopped = true;
        if (this.track) this.mark(0, this.track.cues.length, false);
        this.host.setStatus?.(status);
    }
}
