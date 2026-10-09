// Content-script half of server-side subtitle translation (english spec 023):
// an AI track in the native language, filled part by part just ahead of
// playback, so a film is paid for as it is watched rather than up front.

import type { AppState } from '../AppState';
import { labelForLanguage } from '../languages';
import type { Track } from '../types';
import { prepareTrack, type PreparedTrack } from './track';
import type { PartReply, StoreReply } from './worker';

export type AiStatus = 'working' | 'ready' | 'auth' | 'quota' | 'limit' | 'unavailable' | 'unsupported';

export interface AiHost {
    state: AppState;
    site: string;
    refresh(): void;
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
const RETRY_MS = 15000;

export const AI_SUFFIX = ' · AI';

export class AiTranslator {
    source: Track | null = null;
    private track: PreparedTrack | null = null;
    private ai: Track | null = null;
    private done = new Set<number>();
    private stored = false;
    private busy = false;
    private stopped = false;

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
        state.addTrack(this.aiName, source.subtitles.map((s) => ({ startTime: s.startTime, endTime: s.endTime, text: '' })));
        this.ai = state.tracks.find((t) => t.name === this.aiName) ?? null;
        this.host.setStatus?.('working');
        this.host.refresh();
        void this.tick();
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
            if (!this.done.has(p)) return p;
        }
        return null;
    }

    private async tick(): Promise<void> {
        if (this.stopped || this.busy) return;
        const p = this.nextPart();
        if (p === null) {
            this.host.later(() => void this.tick(), IDLE_MS);
            return;
        }
        const [from, to] = this.parts()[p];
        this.busy = true;
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
            this.fill(reply.from, reply.lines);
            this.done.add(p);
            this.host.setStatus?.('ready');
            void this.tick();
            return;
        }
        switch (reply.code) {
            case 'track_unknown':
                if (this.stored) return this.halt('limit');
                this.stored = true;
                return this.store();
            case 'auth':
            case 'quota':
                return this.halt(reply.code);
            case 'unavailable':
                this.host.later(() => void this.tick(), reply.retryAfterMs ?? RETRY_MS);
                return;
            default:
                return this.halt('unavailable');
        }
    }

    private async store(): Promise<void> {
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
        if (!reply.ok && reply.reason === 'too_long') return this.halt('unavailable');
        if (!reply.ok && reply.reason === 'auth') return this.halt('auth');
        // Stored, or refused because someone else stored it first: ask once more.
        void this.tick();
    }

    private fill(from: number, lines: string[]): void {
        if (!this.ai) return;
        const index = this.track!.index;
        lines.forEach((line, k) => {
            const cue = this.ai!.subtitles[index[from + k]];
            if (cue) cue.text = line;
        });
        this.host.refresh();
    }

    private halt(status: AiStatus): void {
        this.stopped = true;
        this.host.setStatus?.(status);
    }
}
