// POST /dictionary/installations: no token, once; a failure is retried at the next worker start, guest check or sign-in.

import { INSTALLATION_KEYS } from '../auth/storage';

export interface RecordDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
}

// A worker start and an install event may both find the ID unrecorded; one request serves both.
let recording: Promise<boolean> | null = null;

/** Records the stored ID unless it already is; true once recorded. Never throws. */
export function recordInstallation(baseUrl: string, edition: string, deps: RecordDeps): Promise<boolean> {
    if (!baseUrl) return Promise.resolve(false);
    recording ??= send(baseUrl, edition, deps).finally(() => {
        recording = null;
    });
    return recording;
}

async function send(baseUrl: string, edition: string, deps: RecordDeps): Promise<boolean> {
    try {
        const got = await chrome.storage.local.get([INSTALLATION_KEYS.id, INSTALLATION_KEYS.fresh, INSTALLATION_KEYS.recorded]);
        if (got[INSTALLATION_KEYS.recorded] === true) return true;
        const id = got[INSTALLATION_KEYS.id];
        if (typeof id !== 'string' || !id) return false;
        const res = await deps.fetch(`${baseUrl.replace(/\/+$/, '')}/dictionary/installations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, edition, fresh: got[INSTALLATION_KEYS.fresh] === true }),
        });
        if (!res.ok) return false;
        await chrome.storage.local.set({ [INSTALLATION_KEYS.recorded]: true });
        await chrome.storage.local.remove(INSTALLATION_KEYS.fresh);
        return true;
    } catch {
        return false;
    }
}
