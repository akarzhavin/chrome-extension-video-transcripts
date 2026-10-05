// The worker's side of the welcome page on lingogram.ai/welcome/.
//
// The page lives on the site so it can change without a store review; the
// choices it collects live here. It talks to the extension over the same
// externally_connectable channel the sign-in handoff uses, with its own message
// type, and only from the frontend origins the handoff already trusts.
//
// Nothing the page sends is trusted as-is: language codes must be ones this
// edition offers, the one pref the page may set (word highlighting) must be a
// boolean, and the sign-in challenge (nonce) is issued HERE; the
// token itself still arrives through the existing handoff message and check.

import { handleAuthMessage } from '../auth/background';
import { setPendingAuthNonce } from '../auth/storage';
import { SUPPORTED_LANGUAGES, loadLanguagePrefs, saveLanguagePrefs } from '../languages';
import { loadPrefs, savePrefs } from '../prefs';
import { isTrustedSiteSender } from '../site-sender';
import type { Edition } from '../sibling';
import { loadWelcomeState, saveWelcomeState } from './welcome';

export const WELCOME_MESSAGE_TYPE = 'lingogram-welcome';

export type WelcomeOp = 'state' | 'setLanguages' | 'setPrefs' | 'beginSignIn' | 'progress';

export interface WelcomeMessage {
    type: typeof WELCOME_MESSAGE_TYPE;
    op: WelcomeOp;
    [k: string]: unknown;
}

export function isWelcomeMessage(message: unknown): message is WelcomeMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === WELCOME_MESSAGE_TYPE
    );
}

export interface BridgeOptions {
    edition: Edition;
    /** Language codes this edition offers; all supported when absent. */
    languages?: readonly string[];
}

/** What the page needs to render its steps. */
export interface WelcomeSnapshot {
    ok: true;
    edition: Edition;
    signedIn: boolean;
    email: string;
    learning: string;
    native: string;
    languages: Array<{ code: string; label: string; native: string }>;
    pageHighlight: boolean;
    skippedAccount: boolean;
    finished: boolean;
}

/** The languages this edition offers: its own list, or all supported ones. */
export function offered(opts: BridgeOptions) {
    return opts.languages ? SUPPORTED_LANGUAGES.filter((l) => opts.languages!.includes(l.code)) : SUPPORTED_LANGUAGES;
}

async function snapshot(opts: BridgeOptions): Promise<WelcomeSnapshot> {
    const [auth, langs, prefs, w] = await Promise.all([
        handleAuthMessage({ action: 'AUTH_STATUS' }) as Promise<{ signedIn: boolean; email?: string }>,
        loadLanguagePrefs(),
        loadPrefs(),
        loadWelcomeState(),
    ]);
    return {
        ok: true,
        edition: opts.edition,
        signedIn: !!auth?.signedIn,
        email: auth?.signedIn ? auth.email ?? '' : '',
        learning: langs?.learning ?? '',
        native: langs?.native ?? '',
        languages: offered(opts).map(({ code, label, native }) => ({ code, label, native })),
        pageHighlight: prefs.pageHighlight,
        skippedAccount: w.skippedAccount,
        finished: w.finished,
    };
}

type Reply = { ok: boolean; error?: string; nonce?: string } | WelcomeSnapshot;

/** One message, validated and applied. Exported for tests. */
export async function handleWelcomeMessage(msg: WelcomeMessage, opts: BridgeOptions): Promise<Reply> {
    switch (msg.op) {
        case 'state':
            return snapshot(opts);
        case 'setLanguages': {
            const codes = offered(opts).map((l) => l.code);
            const { learning, native } = msg;
            if (typeof learning !== 'string' || typeof native !== 'string' || !codes.includes(learning) || !codes.includes(native)) {
                return { ok: false, error: 'unknown language' };
            }
            await saveLanguagePrefs({ learning, native }, 'welcome');
            return { ok: true };
        }
        case 'setPrefs': {
            const raw = msg.prefs;
            if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'prefs required' };
            const allowed = new Set<string>(['pageHighlight']);
            const patch: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(raw)) {
                if (!allowed.has(k) || typeof v !== 'boolean') return { ok: false, error: `not settable: ${k}` };
                patch[k] = v;
            }
            await savePrefs(patch);
            return { ok: true };
        }
        case 'beginSignIn': {
            // The page signs the learner in itself (its Account step is the
            // sign-up form) and then sends the usual handoff. The one-shot
            // challenge that handoff must carry is issued here, exactly as
            // AUTH_SIGN_IN_VIA_LINGOGRAM issues it for the /extension-auth tab;
            // only a trusted frontend origin ever receives it.
            const nonce = crypto.randomUUID();
            await setPendingAuthNonce(nonce);
            return { ok: true, nonce };
        }
        case 'progress': {
            const w = await loadWelcomeState();
            if (msg.skippedAccount === true) w.skippedAccount = true;
            if (msg.finished === true) w.finished = true;
            await saveWelcomeState(w);
            return { ok: true };
        }
        default:
            return { ok: false, error: 'unknown op' };
    }
}

export function installWelcomeBridge(opts: BridgeOptions): void {
    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
        if (!isWelcomeMessage(message)) return false;
        if (!isTrustedSiteSender(sender)) {
            sendResponse({ ok: false, error: 'unauthorized origin' });
            return false;
        }
        handleWelcomeMessage(message, opts).then(sendResponse, (e) =>
            sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }),
        );
        return true;
    });
}
