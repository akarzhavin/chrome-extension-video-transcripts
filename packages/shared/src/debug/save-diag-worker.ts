// ── The service worker's half of the save log ───────────────────────────────
//
// Built per ADD_WORD / REMOVE_WORD, only in a dev build and only when the
// content script asked (its diagnostics switch is on). firestoreRest reports
// each request into it; the handler returns the snapshot on the reply, success
// or failure, and the content script files it with the press (save-log.ts).
//
// Records statuses, Firestore's error status and timings. Never a token, never
// a header: the Authorization value is not even passed in.
import type { SaveRequestDiag, SentinelDiag, WorkerSaveDiag } from './save-log';

export interface WorkerDiag {
    /** The token was refreshed (successfully) by a request started at `startedAt`. */
    tokenRefreshed(startedAt: number): void;
    sentinel(s: SentinelDiag): void;
    refusalTreatedAsSuccess(): void;
    /** Report a Firestore answer. Reads the error body from a clone. */
    response(kind: SaveRequestDiag['kind'], res: Response, startedAt: number): Promise<void>;
    /** Report a request that threw instead of answering. */
    failed(kind: SaveRequestDiag['kind'], err: unknown, startedAt: number): void;
    done(error?: unknown): WorkerSaveDiag;
}

export function createWorkerDiag(
    auth: { uid?: string; expiresAt?: number } | null,
    now: () => number = Date.now,
): WorkerDiag {
    const t0 = now();
    const snap: WorkerSaveDiag = {
        session: !!auth,
        uidTail: auth?.uid ? auth.uid.slice(-6) : undefined,
        tokenExpiresInMs: typeof auth?.expiresAt === 'number' ? auth.expiresAt - t0 : undefined,
        tokenRefreshed: false,
        requests: [],
        totalMs: 0,
    };
    return {
        tokenRefreshed: (startedAt) => {
            snap.tokenRefreshed = true;
            snap.requests.push({ kind: 'token-refresh', status: 200, ms: now() - startedAt });
        },
        sentinel: (s) => {
            snap.sentinel = s;
        },
        refusalTreatedAsSuccess: () => {
            snap.refusalTreatedAsSuccess = true;
        },
        response: async (kind, res, startedAt) => {
            const entry: SaveRequestDiag = { kind, status: res.status, ms: now() - startedAt };
            snap.requests.push(entry);
            if (res.ok) return;
            try {
                const body = JSON.parse(await res.clone().text()) as {
                    error?: { status?: string; message?: string };
                };
                if (body?.error?.status) entry.errorStatus = body.error.status;
                if (body?.error?.message) entry.errorMessage = body.error.message.slice(0, 300);
            } catch {
                // Not JSON, or a stand-in without clone(): the status alone stays.
            }
        },
        failed: (kind, err, startedAt) => {
            snap.requests.push({
                kind,
                status: 0,
                errorMessage: String(err instanceof Error ? err.message : err).slice(0, 300),
                ms: now() - startedAt,
            });
        },
        done: (error) => {
            snap.totalMs = now() - t0;
            if (error !== undefined) {
                snap.error = String(error instanceof Error ? error.message : error).slice(0, 500);
            }
            return snap;
        },
    };
}

const DIAG_PROP = '__lingogramSaveDiag';

/** Carry a snapshot on a thrown error up to the message handler. */
export function attachDiag(err: unknown, diag: WorkerSaveDiag): void {
    if (err && typeof err === 'object') {
        try {
            (err as Record<string, unknown>)[DIAG_PROP] = diag;
        } catch {
            // A frozen error: the reply goes without the snapshot.
        }
    }
}

/** The reply fields for a thrown save: `{ diag }` when one was attached. */
export function diagOf(err: unknown): { diag?: WorkerSaveDiag } {
    const d = err && typeof err === 'object' ? (err as Record<string, unknown>)[DIAG_PROP] : undefined;
    return d ? { diag: d as WorkerSaveDiag } : {};
}
