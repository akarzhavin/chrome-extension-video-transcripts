// The worker's side of the settings page on lingogram.ai.
//
// The page lives on the site so it can change without a store review; the
// switches it shows live here. It talks over the same externally_connectable
// channel as the welcome page, with its own message type and the same origin
// check (site-sender.ts).
//
// Nothing the page sends is trusted as-is. A write is all-or-nothing: the whole
// message is validated first and nothing is stored unless every part is valid.

import { setAnalyticsEverywhere } from './analytics-consent';
import { handleAuthMessage } from './auth/background';
import { setPendingAuthNonce } from './auth/storage';
import { normalizeHost } from './highlight-hosts';
import { SUPPORTED_LANGUAGES, loadLanguagePrefs, saveLanguagePrefs } from './languages';
import { loadPrefs, savePrefs, sitePrefKey, type Prefs, type VideoSite } from './prefs';
import { loadHighlightPrefs, saveHighlightPrefs, type HighlightChange } from './highlight-prefs';
import { isTrustedSiteSender } from './site-sender';
import { SITE_NAMES, ownSites } from './welcome/welcome';
import { offered, type BridgeOptions } from './welcome/bridge';

export const SETTINGS_MESSAGE_TYPE = 'lingogram-settings';

export type SettingsOp = 'state' | 'set' | 'beginSignIn';

export interface SettingsMessage {
    type: typeof SETTINGS_MESSAGE_TYPE;
    op: SettingsOp;
    [k: string]: unknown;
}

export function isSettingsMessage(message: unknown): message is SettingsMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === SETTINGS_MESSAGE_TYPE
    );
}

/** What the page needs to render its switches. */
export interface SettingsSnapshot {
    ok: true;
    edition: BridgeOptions['edition'];
    version: string;
    signedIn: boolean;
    learning: string;
    native: string;
    languages: Array<{ code: string; label: string; native: string }>;
    sites: Array<{ id: VideoSite; name: string; enabled: boolean }>;
    pageHighlight: boolean;
    analyticsEnabled: boolean;
    /** Sites the page highlight is switched off on (the popup's per-site switch). */
    highlightOffHosts: string[];
}

async function snapshot(opts: BridgeOptions): Promise<SettingsSnapshot> {
    const [auth, langs, prefs, highlight] = await Promise.all([
        handleAuthMessage({ action: 'AUTH_STATUS' }) as Promise<{ signedIn: boolean }>,
        loadLanguagePrefs(),
        loadPrefs(),
        // From the edition that paints, which may be the other one.
        loadHighlightPrefs(),
    ]);
    return {
        ok: true,
        edition: opts.edition,
        version: chrome.runtime.getManifest().version,
        signedIn: !!auth?.signedIn,
        learning: langs?.learning ?? '',
        native: langs?.native ?? '',
        languages: offered(opts).map(({ code, label, native }) => ({ code, label, native })),
        sites: ownSites(opts.edition).map((id) => ({
            id,
            name: SITE_NAMES[id],
            enabled: prefs[sitePrefKey(id)],
        })),
        pageHighlight: highlight.pageHighlight,
        analyticsEnabled: prefs.analyticsEnabled,
        highlightOffHosts: highlight.highlightOffHosts,
    };
}

type Reply = { ok: boolean; error?: string; nonce?: string } | SettingsSnapshot;

/** A hostname as the page may name one: letters, digits, dots, hyphens. */
const HOST = /^[a-z0-9.-]{1,253}$/;

const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys of `obj` outside `allowed`, or null when there are none. */
function strayKey(obj: Record<string, unknown>, allowed: readonly string[]): string | null {
    return Object.keys(obj).find((k) => !allowed.includes(k)) ?? null;
}

interface ValidSet {
    languages?: { learning: string; native: string };
    prefs: Partial<Prefs>;
    /**
     * The highlight settings, written where the highlight reads them
     * (highlight-prefs.ts). One site switched on or off is applied to the list
     * as it is when written: a whole list sent by the page would undo a change
     * the popup made since the page read it.
     */
    highlight: HighlightChange;
}

/** The message's changes, or the reason it is refused. Writes nothing. */
function validateSet(msg: SettingsMessage, opts: BridgeOptions): ValidSet | string {
    const stray = strayKey(msg, ['type', 'op', 'languages', 'prefs']);
    if (stray) return `unknown key: ${stray}`;
    const out: ValidSet = { prefs: {}, highlight: {} };

    if (msg.languages !== undefined) {
        const l = msg.languages;
        if (!isPlain(l)) return 'languages must be an object';
        const bad = strayKey(l, ['learning', 'native']);
        if (bad) return `unknown key: languages.${bad}`;
        const codes = offered(opts).map((x) => x.code);
        const { learning, native } = l;
        if (typeof learning !== 'string' || typeof native !== 'string' || !codes.includes(learning) || !codes.includes(native)) {
            return 'unknown language';
        }
        out.languages = { learning, native };
    }

    if (msg.prefs !== undefined) {
        const p = msg.prefs;
        if (!isPlain(p)) return 'prefs must be an object';
        const bad = strayKey(p, ['pageHighlight', 'analyticsEnabled', 'sites', 'highlightHost']);
        if (bad) return `unknown key: prefs.${bad}`;
        for (const k of ['pageHighlight', 'analyticsEnabled'] as const) {
            if (p[k] === undefined) continue;
            if (typeof p[k] !== 'boolean') return `${k} must be a boolean`;
        }
        if (typeof p.analyticsEnabled === 'boolean') out.prefs.analyticsEnabled = p.analyticsEnabled;
        if (typeof p.pageHighlight === 'boolean') out.highlight.pageHighlight = p.pageHighlight;
        if (p.sites !== undefined) {
            const s = p.sites;
            if (!isPlain(s)) return 'sites must be an object';
            const own = ownSites(opts.edition);
            for (const [id, on] of Object.entries(s)) {
                if (!(['youtube', 'netflix', 'rezka'] as string[]).includes(id)) return `unknown key: prefs.sites.${id}`;
                if (!own.includes(id as VideoSite)) return `site not in this edition: ${id}`;
                if (typeof on !== 'boolean') return `sites.${id} must be a boolean`;
                out.prefs[sitePrefKey(id as VideoSite)] = on;
            }
        }
        if (p.highlightHost !== undefined) {
            const h = p.highlightHost;
            if (!isPlain(h)) return 'highlightHost must be an object';
            const badH = strayKey(h, ['host', 'on']);
            if (badH) return `unknown key: prefs.highlightHost.${badH}`;
            if (typeof h.host !== 'string' || !HOST.test(normalizeHost(h.host))) return 'highlightHost.host must be a hostname';
            if (typeof h.on !== 'boolean') return 'highlightHost.on must be a boolean';
            out.highlight.highlightHost = { host: h.host, on: h.on };
        }
    }
    return out;
}

/** One message, validated and applied. Exported for tests. */
export async function handleSettingsMessage(msg: SettingsMessage, opts: BridgeOptions): Promise<Reply> {
    switch (msg.op) {
        case 'state':
            return snapshot(opts);
        case 'set': {
            const v = validateSet(msg, opts);
            if (typeof v === 'string') return { ok: false, error: v };
            if (v.languages) await saveLanguagePrefs(v.languages, 'site');
            // The stats choice is one for both editions: written here and there.
            const { analyticsEnabled, ...own } = v.prefs;
            if (analyticsEnabled !== undefined) await setAnalyticsEverywhere(analyticsEnabled);
            if (Object.keys(own).length > 0) await savePrefs(own);
            if (Object.keys(v.highlight).length > 0 && !(await saveHighlightPrefs(v.highlight))) {
                return { ok: false, error: 'the edition that highlights words did not save the change' };
            }
            return { ok: true };
        }
        case 'beginSignIn': {
            // The page connects a signed-out extension itself: it mints the
            // token for its own signed-in learner and sends the usual handoff,
            // which must carry this one-shot challenge. Issued exactly as the
            // welcome bridge and AUTH_SIGN_IN_VIA_LINGOGRAM issue it; only a
            // trusted frontend origin reaches this handler.
            const nonce = crypto.randomUUID();
            await setPendingAuthNonce(nonce);
            return { ok: true, nonce };
        }
        default:
            return { ok: false, error: 'unknown op' };
    }
}

export function installSettingsBridge(opts: BridgeOptions): void {
    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
        if (!isSettingsMessage(message)) return false;
        if (!isTrustedSiteSender(sender)) {
            sendResponse({ ok: false, error: 'unauthorized origin' });
            return false;
        }
        handleSettingsMessage(message, opts).then(sendResponse, (e) =>
            sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }),
        );
        return true;
    });
}
