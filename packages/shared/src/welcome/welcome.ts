// The welcome page's state on the extension side.
//
// The page itself lives on lingogram.ai/welcome/ (apps/site): three steps in a
// left menu — Language, Account, Start — reached on install and from the
// popup's "Finish setup". It reads and writes everything through the worker
// (bridge.ts); this module holds the bits both ends of that share.

import { config } from '../auth/config';
import { WELCOME_KEYS } from '../auth/storage';
import type { VideoSite } from '../prefs';
import type { Edition } from '../sibling';

export interface WelcomeState {
    /** Pressed "Skip for now" on the account step. */
    skippedAccount: boolean;
    /** Pressed the last button. The popup stops offering "Finish setup". */
    finished: boolean;
}

const KEY = WELCOME_KEYS.state;

export const INITIAL_STATE: WelcomeState = { skippedAccount: false, finished: false };

export async function loadWelcomeState(): Promise<WelcomeState> {
    try {
        const v = (await chrome.storage.local.get(KEY)) as Record<string, unknown>;
        const raw = v[KEY] as Partial<WelcomeState> | undefined;
        if (!raw || typeof raw !== 'object') return { ...INITIAL_STATE };
        return { skippedAccount: raw.skippedAccount === true, finished: raw.finished === true };
    } catch {
        return { ...INITIAL_STATE };
    }
}

export async function saveWelcomeState(s: WelcomeState): Promise<void> {
    try {
        await chrome.storage.local.set({ [KEY]: s });
    } catch {
        // best-effort: the page still works for this visit.
    }
}

/** The video sites this edition runs on: the switches its popup shows. */
export function ownSites(edition: Edition): VideoSite[] {
    return edition === 'youtube' ? ['youtube', 'netflix'] : ['rezka'];
}

/** Display names of the video sites, as the popup and the settings page show them. */
export const SITE_NAMES: Record<VideoSite, string> = { youtube: 'YouTube', netflix: 'Netflix', rezka: 'HDrezka' };

/**
 * The welcome page's address. `id` tells the page which extension to talk to
 * (the store id, or an unpacked build's own); `cid` joins the visit to the
 * install in analytics, and is left out when unknown.
 */
export function welcomeUrl(ext: string, id: string, cid = ''): string {
    const q = new URLSearchParams({ ext, id });
    if (cid) q.set('cid', cid);
    return `${config.frontendBaseUrl}/welcome/?${q.toString()}`;
}
