// ── Dev-only subtitle load recorder ─────────────────────────────────────────
//
// Why this exists: the codebase already records the VERDICT of a subtitle load
// — no_subtitles / subs_partial / subs_rate_limited carry a failure, a status,
// an attempt count and the breaker's escalation step. What it does not record
// is the SEQUENCE that produced the verdict, and that is the part you need when
// a video shows "No subtitles" and you want to know why afterwards:
//
//   - fetchTimedText() retries inside itself (empty-body re-asks, backoff
//     sleeps, breaker trips) and only the final VttOutcome escapes;
//   - the pot cascade lives in the MAIN world and reports nothing but console
//     lines, which are gone by the time anyone looks;
//   - resolveLiveBaseUrl() swaps a stale signed URL for a fresh one silently;
//   - the timer layer concludes "no subtitles" from SILENCE, and which of its
//     branches fired is written down nowhere at all.
//
// So this module keeps the whole sequence in a ring buffer, per video, and
// hands it over as one JSON file. It is pure — no DOM, no chrome.*, no module
// globals — so both worlds can import it and it is testable without a browser.
//
// Everything here is dev-only. Callers guard on the `__EXT_ENV__ === 'dev'`
// literal (which Vite substitutes before minification, so the guarded code is
// dropped from production bundles); nothing in this file does the guarding
// itself, because a pure module cannot be trusted to be the last word on it.
import type { VttFailure } from './timedtext-fetch';

/** Which world recorded an event. The two see genuinely different things. */
export type TraceWorld = 'main' | 'iso';

/**
 * One thing that happened on the subtitle path.
 *
 * A discriminated union rather than a free-form {msg, data} log line: the point
 * of the trace is to be read back mechanically — "how many attempts did this
 * key actually make", "did the URL change between re-asks" — and a string log
 * can only be grepped. Every arm carries exactly the fields that arm needs.
 */
export type TraceEvent =
    // ── navigation & discovery (MAIN world) ──────────────────────────────
    | { ev: 'nav'; videoId: string | null; url: string }
    /**
     * A player-response read. `source` is the load-bearing field: the SSR
     * ytd-app copy lists the right tracks behind signed URLs the server no
     * longer honours, so a video served from it fails in a way that looks like
     * a network problem. `polls` says how long broadcastCurrent() spun.
     */
    | {
          ev: 'player_response';
          source: 'player-api' | 'ytd-app' | 'none';
          videoId?: string;
          trackCount: number;
          polls: number;
      }
    | { ev: 'catalog'; tracks: Array<{ lang: string; kind?: string; name: string }> }
    | { ev: 'no_captions'; videoId: string }
    // ── planning (isolated world) ────────────────────────────────────────
    | { ev: 'decision'; decision: 'setup' | 'defer' | 'load'; isShorts: boolean; collapsed: boolean }
    | { ev: 'plan'; requests: Array<{ key: string; name: string; tlang?: string }> }
    /**
     * A track was asked for. `deduped` marks one that collapsed onto an
     * identical in-flight request and so produced no attempts of its own —
     * without it the trace shows a track receiving an answer it never asked
     * for, which reads as a recorder bug rather than as deduplication.
     */
    | { ev: 'request'; key: string; tlang?: string; probe: boolean; deduped?: boolean }
    // ── the network leg (MAIN world) ─────────────────────────────────────
    /** Whether resolveLiveBaseUrl() actually found a fresher URL, and the URL used. */
    | { ev: 'url_resolved'; key: string; changed: boolean; url: string }
    | { ev: 'attempt'; key: string; attempt: number; url: string; potPresent: boolean }
    | {
          ev: 'response';
          key: string;
          attempt: number;
          status: number;
          bytes: number;
          headers: Record<string, string>;
          bodyHead: string;
          classified?: VttFailure;
      }
    | { ev: 'retry_sleep'; key: string; attempt: number; ms: number; reason: 'backoff' | 'empty' | 'retry-after' }
    | { ev: 'breaker'; action: 'trip' | 'reset' | 'blocked'; step: number; remainingMs: number }
    | { ev: 'pot'; action: 'sniffed' | 'mint_start' | 'mint_done'; present: boolean; source?: string }
    | { ev: 'outcome'; key: string; ok: boolean; failure?: VttFailure; status?: number; attempts: number }
    // ── receipt & verdict (isolated world) ───────────────────────────────
    | { ev: 'received'; key: string; stale: boolean; bytes: number; parsedCues?: number }
    | { ev: 'timer'; which: 'no-subs-stage1' | 'no-subs-stage2' | 'pending-track'; pending: number; tracks: number }
    | {
          ev: 'verdict';
          kind: 'loaded' | 'no-subtitles' | 'partial';
          cause?: string;
          failure?: string;
          trackCount: number;
      };

/**
 * The events fetchTimedText() and RateLimitBreaker can report.
 *
 * A subset rather than the whole union because those two know nothing about
 * videos, worlds or sessions — they see one URL and its answers. The caller
 * stamps the rest. Keeping the sink's type this narrow is what lets
 * timedtext-fetch.ts import from here with `import type` and stay pure.
 */
export type FetchTraceEvent = Extract<
    TraceEvent,
    { ev: 'attempt' | 'response' | 'retry_sleep' | 'breaker' | 'url_resolved' }
>;

/** A trace event as stored: the event, when it happened, and who saw it. */
export type StampedEvent = TraceEvent & {
    /** ms since this session opened. Relative, so sessions are comparable. */
    t: number;
    w: TraceWorld;
};

export interface TraceSession {
    videoId: string;
    /** Wall-clock start, so a downloaded report can be tied to a real moment. */
    startedAt: number;
    url: string;
    events: StampedEvent[];
    /**
     * Events discarded to stay inside the per-session cap, counted by kind.
     *
     * By kind rather than a single total, because the whole point of protecting
     * the skeleton (see PROTECTED_KINDS) is that WHICH events were surrendered
     * is the difference between a trace that can still be read and one that
     * cannot. `{attempt: 60}` says the retry burst was thinned and the story is
     * intact; `{catalog: 1}` says the record of what the video offered is gone
     * and the reader must not assume it was never read.
     *
     * Recorded rather than dropped silently: a trace that quietly lost its
     * middle would be read as a complete story with a gap in the BEHAVIOUR,
     * which is worse than no trace at all.
     */
    dropped: Partial<Record<TraceEvent['ev'], number>>;
}

/** How many videos are kept. The failure is usually noticed within a few. */
export const MAX_SESSIONS = 6;
/** Per-session event cap. A healthy load is ~20 events; a pathological one runs long. */
export const MAX_EVENTS_PER_SESSION = 400;
/**
 * How much of a response body is kept, per response.
 *
 * 2KB rather than a few hundred bytes because the whole question a body answers
 * is WHICH KIND of answer it is, and the three kinds are not distinguishable
 * from their first bytes: a json3 envelope with no events, a real track, and an
 * HTML error page all begin unremarkably. 2KB reaches past `wireMagic` into the
 * first cues.
 */
export const BODY_HEAD_BYTES = 2048;
/**
 * Total body text kept per session. Without this one video answering 400 times
 * would carry ~800KB of bodies on its own and evict every other session from
 * storage — the bodies are the only unbounded field in the schema.
 */
export const SESSION_BODY_BUDGET = 96_000;

/**
 * Event kinds that survive eviction while anything else is still evictable.
 *
 * Not all events are worth the same. A session that overflows is overflowing on
 * `attempt`/`response`/`retry_sleep` — the retry burst, hundreds of events that
 * say nearly the same thing, where the fiftieth adds almost nothing to the
 * tenth. The skeleton is a few dozen events that each say something no other
 * event says: which tracks the video HAD, what we decided to ask for, and what
 * the verdict was.
 *
 * Plain oldest-first eviction takes the skeleton first, because the skeleton is
 * what happens at the START of a video. The result reads as a wall of identical
 * failures with no statement of what was being attempted — which is exactly the
 * question you open the trace to answer ("was that language even on offer?").
 *
 * So the volume is surrendered first. The skeleton is not immortal: once no
 * evictable event remains, protected ones go too (see evictOne), because the
 * cap has to hold — a session where the breaker tripped two hundred times must
 * still be bounded.
 */
export const PROTECTED_KINDS: ReadonlySet<TraceEvent['ev']> = new Set([
    'nav',
    'player_response',
    'catalog',
    'no_captions',
    'decision',
    'plan',
    'breaker',
    'outcome',
    'verdict',
]);

/**
 * Response headers worth keeping, as an allow-list.
 *
 * `retry-after` and `content-type` are the two that decide a diagnosis:
 * the first says whether YouTube named its own cooldown, the second tells a
 * json3 answer from an HTML error page wearing a 200.
 */
export const HEADER_ALLOW: readonly string[] = [
    'content-type',
    'content-length',
    'retry-after',
    'date',
    'server',
    'alt-svc',
];

/** `retry-after` → `Retry-After`: the spelling a non-Headers stand-in is keyed by. */
function canonicalHeader(name: string): string {
    return name.replace(/(^|-)([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Read the allow-listed headers off a response.
 *
 * Via `.get(name)` ONLY — never `entries()` or a spread. The Response stand-in
 * the fetch tests use implements `.get` and nothing else, so an implementation
 * that iterated would return `{}` under Jest while working in Chrome: green
 * tests over a broken recorder, which is the failure this whole trace exists
 * to stop happening elsewhere.
 */
export function pickHeaders(headers: { get(name: string): string | null } | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers?.get) return out;
    for (const name of HEADER_ALLOW) {
        try {
            // Ask in both casings. A real Headers.get() is case-insensitive, so
            // the lowercase name alone would be enough in Chrome — but the
            // canonical spelling is what a stand-in backed by a plain object
            // answers to, and this recorder must not see less under test than
            // it sees in the browser.
            const v = headers.get(name) ?? headers.get(canonicalHeader(name));
            if (v !== null && v !== undefined) out[name] = String(v);
        } catch {
            // A stand-in that throws on an unknown name must not take the
            // request down with it; diagnostics are never worth a failure.
        }
    }
    return out;
}

/** Truncate a body for the trace, marking it so a cut is never mistaken for a short body. */
export function clipBody(text: string, limit: number = BODY_HEAD_BYTES): string {
    if (text.length <= limit) return text;
    return text.slice(0, limit) + `…[+${text.length - limit}B]`;
}

/**
 * The recorder.
 *
 * One instance per world. The MAIN world's copy forwards its events across the
 * world boundary instead of keeping them (it has no storage to persist to);
 * the isolated world's copy is the one that holds the ring and gets downloaded.
 */
export class DebugTrace {
    private sessions: TraceSession[] = [];
    private bodyBytes = 0;

    constructor(private now: () => number = Date.now) {}

    /**
     * Open a session for a video.
     *
     * Re-opening the SAME video is a no-op rather than a new session: the
     * caller's boundary ("a genuine video change") and this one have to agree,
     * and a "Search again" that reset the session would throw away the very
     * first failure the user is retrying out of.
     */
    startSession(videoId: string, url: string): void {
        const current = this.current();
        if (current && current.videoId === videoId) return;
        this.sessions.push({
            videoId,
            startedAt: this.now(),
            url,
            events: [],
            dropped: {},
        });
        while (this.sessions.length > MAX_SESSIONS) {
            const gone = this.sessions.shift();
            if (gone) this.bodyBytes -= bodyBytesOf(gone);
        }
    }

    current(): TraceSession | undefined {
        return this.sessions[this.sessions.length - 1];
    }

    all(): readonly TraceSession[] {
        return this.sessions;
    }

    /**
     * Record an event against the open session.
     *
     * Events arriving before any session is open are dropped: they belong to no
     * video, and inventing a session for them would file the tail of the
     * previous video's story under a new heading.
     */
    push(e: TraceEvent, world: TraceWorld = 'iso'): void {
        const session = this.current();
        if (!session) return;
        const stamped = this.stamp(e, world, session);
        session.events.push(stamped);
        this.bodyBytes += bodyBytesOf({ events: [stamped] } as TraceSession);
        this.enforceCaps(session);
    }

    /** Append events recorded elsewhere (the MAIN world) that carry their own stamps. */
    merge(events: StampedEvent[]): void {
        const session = this.current();
        if (!session) return;
        for (const e of events) {
            session.events.push(e);
            this.bodyBytes += bodyBytesOf({ events: [e] } as TraceSession);
        }
        // Keep the timeline readable: the two worlds interleave, and a merge
        // that appended a batch verbatim would show the MAIN world's events
        // after isolated-world events that actually happened later.
        session.events.sort((a, b) => a.t - b.t);
        this.enforceCaps(session);
    }

    private stamp(e: TraceEvent, world: TraceWorld, session: TraceSession): StampedEvent {
        return { ...e, t: this.now() - session.startedAt, w: world } as StampedEvent;
    }

    /** Stamp an event without filing it — for a world that forwards rather than stores. */
    stampFor(e: TraceEvent, world: TraceWorld, startedAt: number): StampedEvent {
        return { ...e, t: this.now() - startedAt, w: world } as StampedEvent;
    }

    private enforceCaps(session: TraceSession): void {
        while (session.events.length > MAX_EVENTS_PER_SESSION) {
            this.evictOne(session);
        }
        // Body budget is enforced by BLANKING bodies oldest-first, not by
        // dropping the events: the shape of the sequence (how many attempts,
        // what statuses, in what order) is what the trace is for, and the body
        // text is the least valuable part of it to keep.
        if (this.bodyBytes <= SESSION_BODY_BUDGET) return;
        for (const e of session.events) {
            if (this.bodyBytes <= SESSION_BODY_BUDGET) break;
            if (e.ev !== 'response' || e.bodyHead === '') continue;
            this.bodyBytes -= e.bodyHead.length;
            e.bodyHead = '';
        }
    }

    /**
     * Remove exactly one event, preferring volume over skeleton.
     *
     * Oldest evictable first; only when nothing evictable is left does the
     * oldest protected event go. That fallback is what keeps the cap a real
     * bound rather than a suggestion — a session made entirely of breaker trips
     * is otherwise unbounded, and an unbounded buffer in chrome.storage is the
     * one failure mode that would take the user's prefs down with it.
     */
    private evictOne(session: TraceSession): void {
        let idx = session.events.findIndex((e) => !PROTECTED_KINDS.has(e.ev));
        if (idx === -1) idx = 0;
        const [gone] = session.events.splice(idx, 1);
        if (!gone) return;
        session.dropped[gone.ev] = (session.dropped[gone.ev] ?? 0) + 1;
        this.bodyBytes -= bodyBytesOf({ events: [gone] } as TraceSession);
    }

    /** Everything, shaped for a file someone opens in an editor months later. */
    toReport(meta: Record<string, unknown> = {}): object {
        return {
            _comment:
                'Lingogram subtitle debug trace (dev build only). One entry per video, newest last. ' +
                'Each event carries `t` (ms since that session opened) and `w` (main = page world, iso = content script). ' +
                'CONTAINS SIGNED TIMEDTEXT URLS AND POT TOKENS — do not paste into a public issue.',
            generatedAt: new Date(this.now()).toISOString(),
            ...meta,
            sessions: this.sessions,
        };
    }

    clear(): void {
        this.sessions = [];
        this.bodyBytes = 0;
    }

    /** Restore a persisted trace (the point of persisting: surviving a reload). */
    load(sessions: TraceSession[]): void {
        this.sessions = sessions.slice(-MAX_SESSIONS);
        this.bodyBytes = this.sessions.reduce((n, s) => n + bodyBytesOf(s), 0);
    }
}

function bodyBytesOf(session: Pick<TraceSession, 'events'>): number {
    let n = 0;
    for (const e of session.events) {
        if (e.ev === 'response') n += e.bodyHead.length;
    }
    return n;
}

// ── the cross-world message ─────────────────────────────────────────────────
// The MAIN world cannot reach chrome.storage (it has no chrome.* at all), so it
// forwards what it saw to the isolated world, which owns the ring and the
// persistence. Batched by the sender: a chatty retry burst would otherwise cost
// one postMessage per attempt.

export interface YtDebugTraceMessage {
    type: 'YT_DEBUG_TRACE';
    events: StampedEvent[];
}

/** Isolated → MAIN: whether to record at all, and which session the stamps are relative to. */
export interface YtDebugSetMessage {
    type: 'YT_DEBUG_SET';
    on: boolean;
    startedAt: number;
}
