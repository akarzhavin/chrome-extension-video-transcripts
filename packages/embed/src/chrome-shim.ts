// A `chrome` stand-in so the extension's own content modules run unmodified in
// a web page.
//
// quick-add-overlay.ts and auth-status-badge.ts are written against the
// extension's background worker: they call chrome.runtime.sendMessage and read
// chrome.runtime.id / chrome.i18n. None of that exists on a website, so rather
// than fork those modules we answer their messages here with canned, local
// data. Saving a word bumps an in-memory counter — nothing leaves the page, and
// nobody is ever signed in for real.
//
// Only the surface those modules actually touch is implemented, so a new
// dependency fails loudly instead of silently half-working.
import type { EmbedOptions } from './types';

interface ShimState {
    savedCount: number;
    signedIn: boolean;
    email?: string;
}

export function installChromeShim(opts: EmbedOptions): () => void {
    const w = window as unknown as { chrome?: unknown };
    // A real extension on the page wins — never shadow it.
    if ((w.chrome as { runtime?: { id?: string } } | undefined)?.runtime?.id) return () => {};

    const state: ShimState = {
        savedCount: opts.savedWordCount ?? 247,
        signedIn: opts.signedIn ?? true,
        email: opts.accountEmail ?? 'you@example.com',
    };

    // The AI badge reads the sign-in from storage (auth/storage.ts keys), not
    // from AUTH_STATUS, so storage answers for state.signedIn and a sign-in or
    // sign-out reaches it as a change, as the worker's writes would.
    type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
    const listeners = new Set<(changes: Changes, area: string) => void>();
    const authEntries = (): Record<string, string> => (state.signedIn ? { 'auth.uid': 'demo', 'auth.idToken': 'demo' } : {});
    const setSignedIn = (v: boolean) => {
        if (state.signedIn === v) return;
        const before = authEntries();
        state.signedIn = v;
        const after = authEntries();
        const changes: Changes = {};
        for (const k of ['auth.uid', 'auth.idToken']) changes[k] = { oldValue: before[k], newValue: after[k] };
        for (const l of listeners) setTimeout(() => l(changes, 'local'), 0);
    };
    const storageGet = async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
        const all = authEntries();
        if (keys == null) return all;
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (k in all) out[k] = all[k];
        return out;
    };

    const handle = (message: Record<string, unknown>): unknown => {
        switch (message.action) {
            case 'AUTH_STATUS':
                return state.signedIn
                    ? { signedIn: true, email: state.email, uid: 'demo', inboxCount: state.savedCount }
                    : { signedIn: false };

            case 'AUTH_SIGN_IN_VIA_LINGOGRAM':
                setSignedIn(true);
                opts.onSignInClick?.();
                return { ok: true };

            case 'AUTH_SIGN_OUT':
                setSignedIn(false);
                return { ok: true };

            case 'ADD_WORD': {
                state.savedCount += 1;
                opts.onWordSaved?.(String(message.term ?? ''), String(message.context ?? ''));
                return { ok: true, wordId: `demo-${state.savedCount}` };
            }

            default:
                return { ok: true };
        }
    };

    const previous = w.chrome;
    w.chrome = {
        runtime: {
            id: 'lingogram-embed',
            lastError: undefined,
            sendMessage: (message: Record<string, unknown>, callback?: (r: unknown) => void) => {
                const response = handle(message ?? {});
                // Async like the real API, so callers that assume a tick still work.
                if (typeof callback === 'function') setTimeout(() => callback(response), 0);
                return Promise.resolve(response);
            },
            onMessage: { addListener: () => {}, removeListener: () => {} },
            getURL: (p: string) => p,
        },
        i18n: {
            // Fall through to the shared msg() helper's English defaults.
            getMessage: () => '',
            getUILanguage: () => 'en',
        },
        // prefs.ts guards on chrome.storage.local, so leaving it out would be
        // fine — but answering keeps preference writes from throwing.
        storage: {
            local: { get: storageGet, set: async () => {} },
            onChanged: {
                addListener: (l: (changes: Changes, area: string) => void) => void listeners.add(l),
                removeListener: (l: (changes: Changes, area: string) => void) => void listeners.delete(l),
            },
        },
    };

    return () => {
        w.chrome = previous;
    };
}
