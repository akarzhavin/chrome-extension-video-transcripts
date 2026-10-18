// Refusals of built-in limits, reported to the backend (english repo spec 032,
// contracts/limit-refusals-api.md): the Firestore rules refuse a write without
// the server ever knowing. Only the limit's name and a count leave the browser.
// Combined, sent at most once a minute, dropped after a day; never throws.

export type RefusalName =
    | 'MAX_WORDS_PER_DAY'
    | 'MAX_TERM_BYTES'
    | 'SUBTITLE_WRITES_PER_DAY'
    | 'SUBTITLE_MAX_CUES'
    | 'SUBTITLE_MAX_DURATION_MS'
    | 'SUBTITLE_MAX_CHARS_PER_SEC'
    | 'SUBTITLE_LANGS'
    // The rules said no and gave no cause.
    | 'rules:words'
    | 'rules:tracks'
    | 'rules:feedback';

export interface RefusalQueue {
    items: Partial<Record<RefusalName, { count: number; since: number }>>;
    lastSent: number;
}

export interface ReportDeps {
    apiBaseUrl: string;
    version: string;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    now: () => number;
    store: { load: () => Promise<RefusalQueue | undefined>; save: (q: RefusalQueue) => Promise<void> };
    schedule: (ms: number, fn: () => void) => void;
}

const GAP_MS = 60_000;
const KEEP_MS = 86_400_000;
const MAX_COUNT = 100; // the server's cap per item

export interface RefusalReports {
    refused: (name: RefusalName) => Promise<void>;
    /** Sends what waits, when the minute since the last report is up. */
    flush: () => Promise<void>;
    /** Resolves once queued work is done (tests). */
    idle: () => Promise<void>;
}

export function createRefusalReports(deps: ReportDeps): RefusalReports {
    let queue: RefusalQueue | undefined;
    let timer = false;
    let chain: Promise<void> = Promise.resolve();
    // One step at a time: a worker can hear two refusals at once.
    const serial = (step: () => Promise<void>): Promise<void> => {
        chain = chain.then(step).catch(() => undefined);
        return chain;
    };
    const load = async (): Promise<RefusalQueue> => {
        if (!queue) {
            let stored: RefusalQueue | undefined;
            try {
                stored = await deps.store.load();
            } catch {
                /* storage gone: start empty */
            }
            queue = stored && typeof stored === 'object' ? stored : { items: {}, lastSent: 0 };
        }
        return queue;
    };
    const save = async (q: RefusalQueue) => {
        try {
            await deps.store.save(q);
        } catch {
            /* best effort */
        }
    };

    const post = async (body: string): Promise<number> => {
        const ask = async (refresh: boolean) => {
            const { idToken } = await deps.token(refresh);
            return deps.fetch(`${deps.apiBaseUrl}/dictionary/limits/refusals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body,
            });
        };
        let res = await ask(false);
        if (res.status === 401) res = await ask(true);
        return res.status;
    };

    const send = async (): Promise<void> => {
        const q = await load();
        const now = deps.now();
        for (const [name, it] of Object.entries(q.items) as [RefusalName, { count: number; since: number }][]) {
            if (now - it.since > KEEP_MS) delete q.items[name];
        }
        const names = Object.keys(q.items) as RefusalName[];
        if (names.length === 0 || !deps.apiBaseUrl) return save(q);
        const wait = q.lastSent + GAP_MS - now;
        if (wait > 0) {
            if (!timer) {
                timer = true;
                deps.schedule(wait, () => {
                    timer = false;
                    void serial(send);
                });
            }
            return save(q);
        }
        const items = names.map((limit) => ({ limit, count: Math.min(q.items[limit]!.count, MAX_COUNT) }));
        q.lastSent = now;
        let status = 0;
        try {
            status = await post(JSON.stringify({ version: deps.version, items }));
        } catch {
            /* offline or signed out: kept */
        }
        const delivered = status >= 200 && status < 300;
        const refused = status >= 400 && status < 500 && status !== 429 && status !== 401;
        if (delivered || refused) {
            for (const { limit, count } of items) {
                const left = q.items[limit]!.count - count;
                if (left > 0) q.items[limit]!.count = left;
                else delete q.items[limit];
            }
        }
        await save(q);
    };

    return {
        refused: (name) =>
            serial(async () => {
                const q = await load();
                const it = q.items[name];
                if (it) it.count++;
                else q.items[name] = { count: 1, since: deps.now() };
                await send();
            }),
        flush: () => serial(send),
        idle: () => chain,
    };
}

/** The limit a failed word save hit, from the error firestoreRest threw; null: not a limit. */
export function wordRefusal(err: unknown): RefusalName | null {
    const m = err instanceof Error ? err.message : String(err);
    if (m.startsWith('Daily limit')) return 'MAX_WORDS_PER_DAY';
    if (m.startsWith('term must be')) return 'MAX_TERM_BYTES';
    if (m.startsWith('Firestore rules 403')) return 'rules:words';
    return null;
}

export const REFUSAL_NAMES: ReadonlySet<string> = new Set<RefusalName>([
    'MAX_WORDS_PER_DAY',
    'MAX_TERM_BYTES',
    'SUBTITLE_WRITES_PER_DAY',
    'SUBTITLE_MAX_CUES',
    'SUBTITLE_MAX_DURATION_MS',
    'SUBTITLE_MAX_CHARS_PER_SEC',
    'SUBTITLE_LANGS',
    'rules:words',
    'rules:tracks',
    'rules:feedback',
]);

let sink: ((name: RefusalName) => void) | null = null;

/** The worker sets where refusals go; elsewhere reportRefusal does nothing. */
export function setRefusalSink(fn: ((name: RefusalName) => void) | null): void {
    sink = fn;
}

export function reportRefusal(name: RefusalName): void {
    sink?.(name);
}
