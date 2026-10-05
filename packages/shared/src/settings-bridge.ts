// The worker's side of the settings page on lingogram.ai.
//
// The page lives on the site so it can change without a store review; the
// switches it shows live here. It talks over the same externally_connectable
// channel as the welcome page, with its own message type and the same origin
// check (site-sender.ts).
//
// Nothing the page sends is trusted as-is. A write is all-or-nothing: the whole
// message is validated first and nothing is stored unless every part is valid.

import { track } from './analytics-bg';
import { handleAuthMessage } from './auth/background';
import { SUPPORTED_LANGUAGES, loadLanguagePrefs, saveLanguagePrefs } from './languages';
import { loadPrefs, savePrefs, sitePrefKey, type Prefs, type VideoSite } from './prefs';
import { isTrustedSiteSender } from './site-sender';
import { SITE_NAMES, ownSites } from './welcome/welcome';
import { offered, type BridgeOptions } from './welcome/bridge';

export const SETTINGS_MESSAGE_TYPE = 'lingogram-settings';

export type SettingsOp = 'state' | 'set';

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
}

async function snapshot(opts: BridgeOptions): Promise<SettingsSnapshot> {
    const [auth, langs, prefs] = await Promise.all([
        handleAuthMessage({ action: 'AUTH_STATUS' }) as Promise<{ signedIn: boolean }>,
        loadLanguagePrefs(),
        loadPrefs(),
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
        pageHighlight: prefs.pageHighlight,
        analyticsEnabled: prefs.analyticsEnabled,
    };
}

type Reply = { ok: boolean; error?: string } | SettingsSnapshot;

const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys of `obj` outside `allowed`, or null when there are none. */
function strayKey(obj: Record<string, unknown>, allowed: readonly string[]): string | null {
    return Object.keys(obj).find((k) => !allowed.includes(k)) ?? null;
}

interface ValidSet {
    languages?: { learning: string; native: string };
    prefs: Partial<Prefs>;
}

/** The message's changes, or the reason it is refused. Writes nothing. */
function validateSet(msg: SettingsMessage, opts: BridgeOptions): ValidSet | string {
    const stray = strayKey(msg, ['type', 'op', 'languages', 'prefs']);
    if (stray) return `unknown key: ${stray}`;
    const out: ValidSet = { prefs: {} };

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
        const bad = strayKey(p, ['pageHighlight', 'analyticsEnabled', 'sites']);
        if (bad) return `unknown key: prefs.${bad}`;
        for (const k of ['pageHighlight', 'analyticsEnabled'] as const) {
            if (p[k] === undefined) continue;
            if (typeof p[k] !== 'boolean') return `${k} must be a boolean`;
            out.prefs[k] = p[k];
        }
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
            if (Object.keys(v.prefs).length > 0) {
                // Reported BEFORE the preference is written, as the popup does:
                // the event is the last one the gate lets through. Only when
                // analytics is on right now, so a page that re-sends "off" does
                // not report an opt-out that already happened.
                if (v.prefs.analyticsEnabled === false && (await loadPrefs()).analyticsEnabled) {
                    await track('analytics_opt_out');
                }
                await savePrefs(v.prefs);
            }
            return { ok: true };
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
