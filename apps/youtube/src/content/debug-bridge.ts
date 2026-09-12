// ── Getting MAIN-world events to the isolated world ─────────────────────────
//
// The two halves of the subtitle path live in different worlds and see
// different things. The MAIN world does the fetching, reads the player
// response and mints the pot; the isolated world plans the requests, receives
// the results and reaches the verdict. A trace that holds only one half cannot
// answer the most common question of all — which side went quiet.
//
// The MAIN world has no chrome.* at all (no storage, no runtime), so it cannot
// read the toggle and cannot persist anything. It forwards; the isolated world
// keeps.
//
// SECURITY. This posts on `window` with a '*' target, so the page can read
// every event — including the signed caption URLs and pot tokens the trace
// deliberately carries. That is acceptable in a dev build and nowhere else,
// which is why installMainTraceSink() folds to null in production and why
// assert-shippable refuses a build containing DEBUG_HELLO.
import type { StampedEvent, TraceEvent, TraceWorld } from './debug-trace';

/** MAIN → isolated: a batch of recorded events. */
export const DEBUG_BATCH = 'LG_TRACE_BATCH';
/** isolated → MAIN: "record or don't, and stamp against this epoch". */
export const DEBUG_STATE = 'LG_TRACE_STATE';
/**
 * isolated → MAIN: "are you there?". Its own name rather than a flag on
 * DEBUG_STATE so assert-shippable has a marker that appears in BOTH bundles —
 * a partial fold (content folds, page-script does not) is then still caught.
 */
export const DEBUG_HELLO = 'LG_TRACE_HELLO';

export interface DebugBatchMessage {
    type: typeof DEBUG_BATCH;
    events: StampedEvent[];
}

export interface DebugStateMessage {
    type: typeof DEBUG_STATE;
    on: boolean;
    /** The open session's start, so both worlds put `t` on one timeline. */
    startedAt: number;
}

/**
 * How many events the MAIN world holds before it knows whether to record.
 *
 * There IS a window: page-script runs at document_start and the content script
 * at document_idle, so the MAIN world is already reading the player response
 * and, on a fast navigation, already fetching before the toggle state can
 * possibly arrive. Discarding that window would blind the trace to exactly the
 * cold-start stretch where failures cluster.
 *
 * Bounded, because it is the one thing here that runs before any decision to
 * record: an unbounded pre-arm on a page that never answers is a leak.
 */
export const PREARM_LIMIT = 300;

/** Coalescing window for outgoing batches. */
export const BATCH_FLUSH_MS = 250;

export interface MainSinkDeps {
    post: (msg: DebugBatchMessage) => void;
    now: () => number;
    setTimer: (fn: () => void, ms: number) => number;
    clearTimer: (id: number) => void;
}

/**
 * The MAIN world's recorder: buffers, then streams once told to.
 *
 * Not a DebugTrace — it owns no ring and no sessions. It stamps and forwards,
 * because the isolated world is the only side that can decide what to keep.
 */
export class MainTraceSink {
    private on = false;
    /** Set once the isolated world has answered; before that we are guessing. */
    private armed = false;
    private startedAt = 0;
    private prearm: StampedEvent[] = [];
    private pending: StampedEvent[] = [];
    private prearmDropped = 0;
    private timer: number | null = null;

    constructor(private deps: MainSinkDeps) {}

    /** Record one event. Cheap and total: never throws, never blocks a fetch. */
    record(e: TraceEvent, world: TraceWorld = 'main'): void {
        if (this.armed && !this.on) return;
        const stamped = { ...e, t: this.deps.now() - this.startedAt, w: world } as StampedEvent;
        if (!this.armed) {
            // Drop the OLDEST, so the buffer always holds the most recent
            // window — a page that sat for a minute before the handshake should
            // hand over what happened just now, not what happened a minute ago.
            this.prearm.push(stamped);
            while (this.prearm.length > PREARM_LIMIT) {
                this.prearm.shift();
                this.prearmDropped++;
            }
            return;
        }
        this.pending.push(stamped);
        this.scheduleFlush();
    }

    /**
     * The isolated world answered.
     *
     * Re-stamps whatever was captured before the answer against the session
     * epoch it just learned: the pre-arm events were stamped against a
     * `startedAt` of 0, which would place them in the far past.
     */
    setState(on: boolean, startedAt: number): void {
        const wasArmed = this.armed;
        this.armed = true;
        this.on = on;
        const previousEpoch = this.startedAt;
        this.startedAt = startedAt;

        if (!on) {
            this.prearm = [];
            this.pending = [];
            this.prearmDropped = 0;
            this.cancelFlush();
            return;
        }
        if (!wasArmed && this.prearm.length > 0) {
            const shift = startedAt - previousEpoch;
            for (const e of this.prearm) e.t -= shift;
            this.pending.push(...this.prearm);
            this.prearm = [];
            this.scheduleFlush();
        }
    }

    /** Events held back by the pre-arm cap — reported so the gap is never silent. */
    droppedBeforeArming(): number {
        return this.prearmDropped;
    }

    private scheduleFlush(): void {
        if (this.timer !== null) return;
        this.timer = this.deps.setTimer(() => {
            this.timer = null;
            this.flush();
        }, BATCH_FLUSH_MS);
    }

    private cancelFlush(): void {
        if (this.timer === null) return;
        this.deps.clearTimer(this.timer);
        this.timer = null;
    }

    /**
     * Send what is queued.
     *
     * Batched rather than one message per event: the retry loop emits several
     * events per millisecond, and every postMessage on `window` is work the
     * page can also observe.
     */
    flush(): void {
        this.cancelFlush();
        if (this.pending.length === 0) return;
        const events = this.pending;
        this.pending = [];
        try {
            this.deps.post({ type: DEBUG_BATCH, events });
        } catch {
            // A failed post is a lost batch, not a broken page.
        }
    }
}

/** Is this message a batch from our own window? */
export function isDebugBatch(data: unknown): data is DebugBatchMessage {
    return (
        !!data &&
        typeof data === 'object' &&
        (data as { type?: unknown }).type === DEBUG_BATCH &&
        Array.isArray((data as { events?: unknown }).events)
    );
}

export function isDebugState(data: unknown): data is DebugStateMessage {
    return (
        !!data &&
        typeof data === 'object' &&
        (data as { type?: unknown }).type === DEBUG_STATE &&
        typeof (data as { on?: unknown }).on === 'boolean'
    );
}
