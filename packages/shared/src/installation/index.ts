// The installation (english repo spec 034-guest-ai-rollout): its ID, its record on the server,
// the guest check and the link at sign-in. Worker-only; not on the package barrel, and the only entry.

import { config } from '../auth/config';
import { refreshGuestFeatures, type FeatureDeps } from '../features/worker';
import type { Edition } from '../sibling';
import { linkInstallation } from './link';
import { postInstallation } from './record';
import { keepLinkPending, markRecorded, mintInstallationId, pendingLink, pendingRecord, readInstallationId } from './store';

type SignedIn = Pick<FeatureDeps, 'fetch' | 'token'>;

/** What the worker hands in: auth/background imports this module, so it cannot be imported back. */
export interface InstallationDeps {
    /** A dev build's backend, restored; config.apiBaseUrl is read only after it. */
    ready: () => Promise<void>;
    /** The signed-in caller, or null signed out. */
    signedIn: () => Promise<SignedIn | null>;
}

const plainFetch = { fetch: (u: string, i: RequestInit) => fetch(u, i) };

// Named by installInstallation; null in a build that never did, which then asks and links nothing.
let edition: Edition | null = null;
let deps: InstallationDeps = { ready: () => Promise.resolve(), signedIn: () => Promise.resolve(null) };

// A worker start and an install event may both find the ID unrecorded; one request serves both.
let recording: Promise<void> | null = null;
// A worker start and a features refresh may both find a link owed; one request serves both.
let relinking: Promise<void> | null = null;

/** The API base URL once a dev build restored its backend. */
async function apiBase(): Promise<string> {
    await deps.ready();
    return config.apiBaseUrl;
}

/** Records the stored ID unless this backend already has. A failure is retried at the next worker start, guest check or sign-in. Never throws. */
function recordInstallation(ed: Edition): Promise<void> {
    recording ??= (async () => {
        try {
            const baseUrl = await apiBase();
            if (!baseUrl) return;
            const pending = await pendingRecord(baseUrl);
            if (pending === 'recorded' || !pending) return;
            if (await postInstallation(baseUrl, { id: pending.id, edition: ed, fresh: pending.fresh }, plainFetch)) await markRecorded(baseUrl);
        } catch {
            // Retried later, as above.
        }
    })().finally(() => {
        recording = null;
    });
    return recording;
}

/** Mints the ID if missing (fresh decides its flag only then) and records it unless recorded; null when storage fails. */
async function ensureInstallation(ed: Edition, fresh: boolean): Promise<string | null> {
    const id = await mintInstallationId(fresh);
    if (id) await recordInstallation(ed);
    return id;
}

/** Worker start: mint at install/update, independent of the analytics switch; retry a pending record and link now. */
export function installInstallation(ed: Edition, worker: InstallationDeps): void {
    edition = ed;
    deps = worker;
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void ensureInstallation(ed, true);
        else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) void ensureInstallation(ed, false);
    });
    // No mint here: on a fresh install it would beat the INSTALL event and record the install as an update.
    // No record without an ID either: the INSTALL event's record would share one that found none.
    void readInstallationId().then((id) => {
        if (id) void recordInstallation(ed);
    });
    void retryLink();
}

/** Signed out: which features the server shows this installation, kept as a guest answer; null without an edition, ID or answer. */
export async function guestCheck(): Promise<Record<string, boolean> | null> {
    const ed = edition;
    if (!ed) return null;
    return refreshGuestFeatures(await apiBase().catch(() => ''), { ...plainFetch, id: () => ensureInstallation(ed, false) });
}

/** At a sign-in hand-off: links this installation to the account; false without an edition or on failure. Never throws. */
export async function linkAtSignIn(signedIn: SignedIn): Promise<boolean> {
    const ed = edition;
    if (!ed) return false;
    const baseUrl = await apiBase().catch(() => '');
    const outcome = await linkInstallation(baseUrl, ed, { ...signedIn, id: () => ensureInstallation(ed, false) });
    // Owed until one lands or is refused for good; a repeat is safe, the server keeps the first account.
    if (baseUrl) await keepLinkPending(outcome === 'owed' ? baseUrl : null).catch(() => undefined);
    return outcome === 'linked';
}

/** A link that failed at sign-in, retried while signed in on the backend it failed on; signedIn defaults to the worker's. Never throws. */
export function retryLink(signedIn?: SignedIn): Promise<void> {
    relinking ??= (async () => {
        try {
            const baseUrl = await apiBase();
            if (!baseUrl || (await pendingLink()) !== baseUrl) return;
            const caller = signedIn ?? (await deps.signedIn());
            if (caller) await linkAtSignIn(caller);
        } catch {
            // Still owed: the next worker start or features refresh tries again.
        }
    })().finally(() => {
        relinking = null;
    });
    return relinking;
}
