// The word-highlight settings, read and written where they take effect.
//
// Only one edition paints the highlight on websites (sibling.ts decides which),
// and it reads its own prefs. The other edition's popup and settings page must
// therefore not touch their own copy: they ask the painting edition instead,
// over the same extension-to-extension channel the editions already use. One
// copy, so nothing to keep in step.

import { withHighlight } from './highlight-hosts';
import { loadPrefs, savePrefs } from './prefs';
import { SIBLING_MESSAGE_TYPE, loadSharedOwner } from './sibling';

export interface HighlightPrefs {
    pageHighlight: boolean;
    highlightOffHosts: string[];
}

/** One change: the switch for all websites, or one website on or off. */
export interface HighlightChange {
    pageHighlight?: boolean;
    highlightHost?: { host: string; on: boolean };
}

export type HighlightRequest =
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'highlightGet' }
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'highlightSet'; change: HighlightChange };

async function readLocal(): Promise<HighlightPrefs> {
    const p = await loadPrefs();
    return { pageHighlight: p.pageHighlight, highlightOffHosts: [...p.highlightOffHosts] };
}

async function writeLocal(change: HighlightChange): Promise<void> {
    if (change.pageHighlight !== undefined) await savePrefs({ pageHighlight: change.pageHighlight });
    if (change.highlightHost) {
        // Applied to the list as it is now, not a list the asker read earlier.
        const { highlightOffHosts } = await loadPrefs();
        await savePrefs({ highlightOffHosts: withHighlight(highlightOffHosts, change.highlightHost.host, change.highlightHost.on) });
    }
}

const isPrefs = (v: unknown): v is HighlightPrefs =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as HighlightPrefs).pageHighlight === 'boolean' &&
    Array.isArray((v as HighlightPrefs).highlightOffHosts) &&
    (v as HighlightPrefs).highlightOffHosts.every((h) => typeof h === 'string');

/**
 * The settings the highlight on websites follows. From the painting edition
 * when that is the other one; this edition's own when it paints, or when the
 * other one does not answer (removed, disabled, an old version).
 */
export async function loadHighlightPrefs(): Promise<HighlightPrefs> {
    const owner = await loadSharedOwner();
    if (owner) {
        try {
            const res = (await chrome.runtime.sendMessage(owner.id, {
                type: SIBLING_MESSAGE_TYPE,
                op: 'highlightGet',
            } satisfies HighlightRequest)) as { ok?: boolean; prefs?: unknown } | undefined;
            if (res?.ok === true && isPrefs(res.prefs)) return res.prefs;
        } catch {
            // not there: fall through to our own
        }
    }
    return readLocal();
}

/**
 * Writes where the highlight reads. Resolves false when the painting edition
 * refused or did not answer: the caller shows the change as not saved rather
 * than writing a copy that nobody reads.
 */
export async function saveHighlightPrefs(change: HighlightChange): Promise<boolean> {
    const owner = await loadSharedOwner();
    if (!owner) {
        await writeLocal(change);
        return true;
    }
    try {
        const res = (await chrome.runtime.sendMessage(owner.id, {
            type: SIBLING_MESSAGE_TYPE,
            op: 'highlightSet',
            change,
        } satisfies HighlightRequest)) as { ok?: boolean } | undefined;
        return res?.ok === true;
    } catch {
        return false;
    }
}

/**
 * The painting edition's side: answers the other edition's get and set.
 * Returns null for any other message, so the caller can pass it on.
 */
export async function answerHighlightRequest(message: unknown): Promise<{ ok: boolean; prefs?: HighlightPrefs; error?: string } | null> {
    const m = message as Partial<HighlightRequest> & { change?: unknown };
    if (m?.type !== SIBLING_MESSAGE_TYPE) return null;
    if (m.op === 'highlightGet') return { ok: true, prefs: await readLocal() };
    if (m.op !== 'highlightSet') return null;
    const c = m.change as HighlightChange | undefined;
    if (typeof c !== 'object' || c === null) return { ok: false, error: 'change must be an object' };
    if (c.pageHighlight !== undefined && typeof c.pageHighlight !== 'boolean') return { ok: false, error: 'pageHighlight must be a boolean' };
    if (c.highlightHost !== undefined) {
        const h = c.highlightHost;
        if (typeof h !== 'object' || h === null || typeof h.host !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(h.host.trim()) || typeof h.on !== 'boolean') {
            return { ok: false, error: 'highlightHost must be {host, on}' };
        }
    }
    await writeLocal(c);
    return { ok: true };
}

/**
 * When ownership moves to this edition, the settings come along: the previous
 * owner's are the ones the learner last saw. Best effort; nothing to take from
 * an edition that no longer answers.
 */
export async function takeHighlightPrefsFrom(siblingId: string): Promise<void> {
    try {
        const res = (await chrome.runtime.sendMessage(siblingId, {
            type: SIBLING_MESSAGE_TYPE,
            op: 'highlightGet',
        } satisfies HighlightRequest)) as { ok?: boolean; prefs?: unknown } | undefined;
        if (res?.ok === true && isPrefs(res.prefs)) {
            await savePrefs({ pageHighlight: res.prefs.pageHighlight, highlightOffHosts: res.prefs.highlightOffHosts });
        }
    } catch {
        // gone: keep our own
    }
}
