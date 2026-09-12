// ── The isolated world's half of the recorder ───────────────────────────────
//
// debug-trace.ts owns the ring and knows nothing about the browser. This owns
// the part that only the isolated world can do: reading the toggle, writing the
// buffer somewhere that survives a reload, and doing both without ever taking
// the subtitle path down with it.
//
// The reload is the whole point. A failure is noticed AFTER it happened — often
// after the user has already hit reload to try and fix it — so a buffer that
// lived only in memory would be empty at exactly the moment it is opened.
//
// Storage discipline, in one line each:
//   - Its own key. Never inside prefs.v1, which savePrefs rewrites wholesale on
//     every overlay-colour click and which both apps read on every page load.
//   - Debounced. The trace records dozens of events in a burst; one write per
//     event would make the recorder more expensive than the thing it watches.
//   - Flushed at the moments after which the tab may not exist: a verdict, and
//     the page going away.
//   - Never throws. Diagnostics that can break a subtitle load are worse than
//     no diagnostics.
import { DebugTrace, MAX_SESSIONS, type StampedEvent, type TraceEvent, type TraceSession } from './debug-trace';

/** Its own storage key, following the existing `dev.`-prefixed convention. */
export const TRACE_KEY = 'debug.trace.v1';

/** How long to sit on a burst of events before writing. */
export const FLUSH_DEBOUNCE_MS = 1500;

/**
 * Ceiling on the serialized buffer.
 *
 * chrome.storage.local gives 10MB by default and the manifest asks for no
 * `unlimitedStorage`, so this is a real budget shared with prefs, languages and
 * the word mirror. 1.5MB is generous for six sessions of text and leaves the
 * rest of the extension's storage untouched.
 */
export const MAX_TOTAL_BYTES = 1_500_000;

export interface StorageLike {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
}

export interface RecorderDeps {
    storage: StorageLike;
    now?: () => number;
    /** Injected so tests drive the debounce without real time passing. */
    setTimer?: (fn: () => void, ms: number) => number;
    clearTimer?: (id: number) => void;
    flushDebounceMs?: number;
}

/**
 * Wraps a DebugTrace with persistence and an on/off switch.
 *
 * The switch gates RECORDING, not the buffer: turning the toggle off must not
 * destroy a trace the user turned it off in order to go and read. Only an
 * explicit clear() does that.
 */
export class TraceRecorder {
    private trace: DebugTrace;
    private enabled = false;
    private timer: number | null = null;
    private readonly storage: StorageLike;
    private readonly now: () => number;
    private readonly setTimer: (fn: () => void, ms: number) => number;
    private readonly clearTimer: (id: number) => void;
    private readonly debounceMs: number;
    /** Counts writes refused by the quota, surfaced in the report rather than swallowed. */
    private quotaFailures = 0;

    constructor(deps: RecorderDeps) {
        this.storage = deps.storage;
        this.now = deps.now ?? Date.now;
        this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
        this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
        this.debounceMs = deps.flushDebounceMs ?? FLUSH_DEBOUNCE_MS;
        this.trace = new DebugTrace(this.now);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(on: boolean): void {
        this.enabled = on;
    }

    /** When the current session opened — the epoch the MAIN world stamps against. */
    sessionStartedAt(): number {
        return this.trace.current()?.startedAt ?? this.now();
    }

    startSession(videoId: string, url: string): void {
        if (!this.enabled) return;
        this.trace.startSession(videoId, url);
        this.scheduleFlush();
    }

    record(e: TraceEvent): void {
        if (!this.enabled) return;
        this.trace.push(e, 'iso');
        // A verdict is the last thing that happens before the user goes looking
        // for the report — and, on a page they are about to reload, possibly the
        // last thing that happens at all. Write it now rather than in 1.5s.
        if (e.ev === 'verdict') void this.flush();
        else this.scheduleFlush();
    }

    /** Events recorded in the MAIN world, already stamped against this session. */
    ingestFromMain(events: StampedEvent[]): void {
        if (!this.enabled || events.length === 0) return;
        this.trace.merge(events);
        this.scheduleFlush();
    }

    sessions(): readonly TraceSession[] {
        return this.trace.all();
    }

    report(meta: Record<string, unknown> = {}): object {
        return this.trace.toReport({
            ...meta,
            ...(this.quotaFailures > 0 ? { quotaFailures: this.quotaFailures } : {}),
        });
    }

    /** Read a persisted buffer back. Called once on boot; never throws. */
    async hydrate(): Promise<void> {
        try {
            const got = await this.storage.get(TRACE_KEY);
            const raw = got?.[TRACE_KEY];
            if (Array.isArray(raw)) this.trace.load(raw as TraceSession[]);
        } catch {
            // A buffer we cannot read is a buffer we start fresh from. The
            // alternative — letting this reject — would break the content
            // script's boot over a diagnostic.
        }
    }

    async clear(): Promise<void> {
        this.trace.clear();
        this.cancelFlush();
        try {
            await this.storage.remove(TRACE_KEY);
        } catch {
            // Nothing to do: the in-memory buffer is already gone, which is
            // what the user asked for.
        }
    }

    private scheduleFlush(): void {
        if (this.timer !== null) return; // already coalescing
        this.timer = this.setTimer(() => {
            this.timer = null;
            void this.flush();
        }, this.debounceMs);
    }

    private cancelFlush(): void {
        if (this.timer === null) return;
        this.clearTimer(this.timer);
        this.timer = null;
    }

    /**
     * Write the buffer out.
     *
     * Public because the page's own lifecycle — visibilitychange, pagehide — is
     * a better flush trigger than any timer, and only the caller can see it.
     */
    async flush(): Promise<void> {
        this.cancelFlush();
        try {
            let sessions = [...this.trace.all()];
            let payload = JSON.stringify(sessions);
            // Drop oldest sessions until it fits. The newest video is the one
            // being debugged; an old one is worth less than the write
            // succeeding at all.
            while (payload.length > MAX_TOTAL_BYTES && sessions.length > 1) {
                sessions = sessions.slice(1);
                payload = JSON.stringify(sessions);
            }
            await this.storage.set({ [TRACE_KEY]: sessions });
        } catch {
            // Quota, an orphaned context, a storage error — all the same here:
            // the in-memory buffer is still readable and downloadable, so the
            // feature degrades to "this session only" rather than failing.
            this.quotaFailures++;
        }
    }
}

/** chrome.storage.local as a StorageLike, or null where there is no extension context. */
export function chromeStorage(): StorageLike | null {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    return {
        get: (key) => chrome.storage.local.get(key) as Promise<Record<string, unknown>>,
        set: (items) => chrome.storage.local.set(items),
        remove: (key) => chrome.storage.local.remove(key),
    };
}

export { MAX_SESSIONS };
