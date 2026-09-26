// ── Dev-only record of every Save / Remove press ────────────────────────────
//
// Why this exists: a save failed live with `Firestore rules 403`, the card
// flipped to "Remove" anyway, and the next press said "sign in". It could not
// be reproduced, and nothing about it survived — the console was gone,
// analytics carries no failure event, and the subtitle recorder does not see
// the save path at all. This keeps, per press, what is needed to explain such a
// failure afterwards: which copy of the extension handled it, what the worker
// asked Firestore and what Firestore answered.
//
// Part of "Subtitle diagnostics": the same switch (prefs.debugMode) and the
// same export. Kept under its own storage key rather than inside the subtitle
// trace, because a save happens with no video open and must not be evicted
// along with videos.
//
// Everything here is dev-only. Callers gate on a module-level
// `DIAG_BUILD = __EXT_ENV__ === 'dev'` constant so production folds the call
// sites and this module with them; nothing here does the guarding itself.

/** Storage key, following the `debug.`-prefixed convention of the subtitle trace. */
export const SAVE_LOG_KEY = 'debug.saves.v1';
/** Presses kept in the rolling window. Saves are rare; this is days of use. */
export const MAX_RECENT = 60;
/** Failures kept apart from the rolling window, so ordinary use cannot evict them. */
export const MAX_FAILURES = 10;
/** Presses kept with each failure: what led up to it. */
export const FAILURE_CONTEXT = 20;

/** One request the worker made for a press, as Firestore answered it. */
export interface SaveRequestDiag {
    kind: 'sentinel' | 'commit' | 'commit-refreshed' | 'commit-reactivate' | 'token-refresh';
    /** HTTP status; 0 when the request itself threw (network, refresh failure). */
    status: number;
    /** Firestore's `error.status`, e.g. PERMISSION_DENIED, ALREADY_EXISTS. */
    errorStatus?: string;
    errorMessage?: string;
    ms: number;
}

/** What the per-user sentinel held when the worker read it. */
export type SentinelDiag =
    | { exists: false }
    | { exists: true; dailyCount: number; dayBucket: number; lastAddedAt?: string };

/** The worker's side of one press. Never carries a token or a header. */
export interface WorkerSaveDiag {
    session: boolean;
    /** Last 6 characters of the uid: enough to tell two accounts apart. */
    uidTail?: string;
    /** Token lifetime left when the press arrived; negative = already expired. */
    tokenExpiresInMs?: number;
    tokenRefreshed: boolean;
    sentinel?: SentinelDiag;
    requests: SaveRequestDiag[];
    /** A removal refused with 403 that the worker reports as success (already not saved). */
    refusalTreatedAsSuccess?: boolean;
    error?: string;
    totalMs: number;
}

export interface CopyIdentity {
    id: string;
    version: string;
    install: 'store' | 'unpacked' | 'unknown';
}

export interface SaveAttempt {
    /** Wall clock, ms. */
    at: number;
    iso: string;
    op: 'save' | 'remove';
    term: string;
    /** The word's mirror entry before the press: 'active', 'removed', or absent. */
    mirrorBefore: string | null;
    site: string;
    copy: CopyIdentity;
    /** Extension id stamped on the panel on this page; null when no panel. */
    panelOwner: string | null;
    outcome: 'ok' | 'failed';
    error?: string;
    /** The toast text the learner saw, if any. */
    shown?: string;
    roundTripMs: number;
    /** Since this copy's previous press. Stamped by appendAttempt. */
    sincePrevMs?: number | null;
    /** Absent when the reply never came (orphaned script, timeout). */
    worker?: WorkerSaveDiag;
}

export interface RetainedFailure {
    attempt: SaveAttempt;
    before: SaveAttempt[];
}

export interface SaveLogData {
    recent: SaveAttempt[];
    failures: RetainedFailure[];
}

export function emptySaveLog(): SaveLogData {
    return { recent: [], failures: [] };
}

/**
 * File one press. Pure: returns the new log, leaves the argument alone.
 *
 * A failure is copied into `failures` with the presses before it at the moment
 * it happens, so the rolling window can move on without taking the evidence.
 */
export function appendAttempt(data: SaveLogData, attempt: SaveAttempt): SaveLogData {
    const prev = data.recent[data.recent.length - 1];
    const stamped: SaveAttempt = { ...attempt, sincePrevMs: prev ? attempt.at - prev.at : null };
    const recent = [...data.recent, stamped].slice(-MAX_RECENT);
    let failures = data.failures;
    if (stamped.outcome === 'failed') {
        const before = data.recent.slice(-FAILURE_CONTEXT);
        failures = [...failures, { attempt: stamped, before }].slice(-MAX_FAILURES);
    }
    return { recent, failures };
}

/** Anything stored under the key that is not the expected shape reads as empty. */
export function coerceSaveLog(v: unknown): SaveLogData {
    const o = v as Partial<SaveLogData> | null | undefined;
    if (!o || !Array.isArray(o.recent) || !Array.isArray(o.failures)) return emptySaveLog();
    return { recent: o.recent, failures: o.failures };
}

function localArea(): chrome.storage.StorageArea | null {
    try {
        return chrome?.storage?.local ?? null;
    } catch {
        return null;
    }
}

export async function loadSaveLog(): Promise<SaveLogData> {
    const area = localArea();
    if (!area) return emptySaveLog();
    try {
        const got = (await area.get(SAVE_LOG_KEY)) as Record<string, unknown>;
        return coerceSaveLog(got[SAVE_LOG_KEY]);
    } catch {
        return emptySaveLog();
    }
}

// Two presses in the same millisecond (a double handler) would otherwise both
// read the old log and the second write would drop the first — exactly the
// case this log exists to show. Serialise the read-modify-write.
let queue: Promise<unknown> = Promise.resolve();

/** Append one press and persist it. Never throws: diagnostics must not break a save. */
export function recordSaveAttempt(attempt: SaveAttempt): Promise<void> {
    const run = queue.then(async () => {
        const area = localArea();
        if (!area) return;
        try {
            const next = appendAttempt(await loadSaveLog(), attempt);
            await area.set({ [SAVE_LOG_KEY]: next });
        } catch {
            // Quota or an orphaned context: the press itself already happened.
        }
    });
    queue = run;
    return run;
}

export async function clearSaveLog(): Promise<void> {
    const area = localArea();
    if (!area) return;
    try {
        await area.remove(SAVE_LOG_KEY);
        // Not left to the storage event: the panel relabels as soon as this
        // resolves, before the event arrives.
        savedCount = 0;
    } catch {
        // Nothing to recover.
    }
}

/** How many presses a report would contain — the count on the Download row. */
export function saveLogSize(data: SaveLogData): number {
    return data.recent.length;
}

/** Which copy of the extension this content script belongs to. */
export function copyIdentity(): CopyIdentity {
    try {
        const m = chrome.runtime.getManifest() as chrome.runtime.Manifest & { update_url?: string };
        return {
            id: chrome.runtime.id ?? 'unknown',
            version: m.version ?? 'unknown',
            // `update_url` is added by the Web Store on install; an unpacked
            // build has none. Readable here, unlike chrome.management, which a
            // content script cannot reach.
            install: m.update_url ? 'store' : 'unpacked',
        };
    } catch {
        return { id: 'unknown', version: 'unknown', install: 'unknown' };
    }
}

/** The extension id that owns the panel on this page (see SidebarUI.init). */
export function panelOwner(): string | null {
    return document.getElementById('vtt-sidebar')?.dataset.vttOwner ?? null;
}

/** The section the exported file carries. */
export function saveLogReport(data: SaveLogData): object {
    return {
        _comment:
            'Word Save / Remove presses recorded by this copy of the extension. `failures` are kept apart ' +
            'from `recent` so later presses cannot evict them; each carries the presses before it. ' +
            '`worker` is the service worker\'s view: every Firestore request with its status. ' +
            'A second installed copy keeps its own log in its own storage.',
        failures: data.failures,
        recent: data.recent,
    };
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Filename-safe local timestamp: 20260926-174233. */
export function fileStamp(d = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}

/** Hand text to the browser as a download. Permission-free: a Blob URL on an <a download>. */
export function downloadText(text: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// The Download row shows a count synchronously, and the log lives in async
// storage — so the count is kept current from storage events, started on first
// use. One listener per page.
let savedCount = 0;
let watching = false;

/** Presses in the log right now, as last seen. Starts watching on first call. */
export function saveLogCount(): number {
    if (!watching) {
        watching = true;
        void loadSaveLog().then((d) => {
            savedCount = saveLogSize(d);
        });
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !(SAVE_LOG_KEY in changes)) return;
                savedCount = saveLogSize(coerceSaveLog(changes[SAVE_LOG_KEY].newValue));
            });
        } catch {
            // No storage events here (orphaned context): the count stays as loaded.
        }
    }
    return savedCount;
}

/** The whole file for an edition with no subtitle recorder (HDrezka). */
export async function saveLogFileText(): Promise<string> {
    let version = 'unknown';
    try {
        version = chrome.runtime.getManifest().version;
    } catch {
        // Orphaned context — the log is still worth reading.
    }
    return JSON.stringify(
        {
            _comment: 'Lingogram diagnostics (dev build only).',
            generatedAt: new Date().toISOString(),
            version,
            ua: navigator.userAgent,
            saves: saveLogReport(await loadSaveLog()),
        },
        null,
        2,
    );
}

/**
 * Download / copy / clear for an edition whose diagnostics are the save log
 * alone. Same verbs as the YouTube recorder's, so the panel's rows need no
 * second shape.
 */
export function saveLogActions(): {
    sessions(): number;
    saves(): number;
    download(): void;
    copy(): Promise<boolean>;
    clear(): Promise<void>;
} {
    saveLogCount();
    return {
        sessions: () => 0,
        saves: () => saveLogCount(),
        download: () => {
            void saveLogFileText().then((text) =>
                downloadText(text, `lingogram-diagnostics-${fileStamp()}.json`));
        },
        copy: () => saveLogFileText()
            .then((text) => {
                // No clipboard (insecure context): report it, do not appear to succeed.
                if (!navigator.clipboard) throw new Error('no clipboard');
                return navigator.clipboard.writeText(text);
            })
            .then(() => true)
            .catch(() => false),
        clear: () => clearSaveLog(),
    };
}
