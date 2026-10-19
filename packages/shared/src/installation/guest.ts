// Signed out: GET /dictionary/guest/features?installation=<id>, no token; kept marked as a guest's answer.

import { parseFeatures } from '../features/rules';
import { accountGeneration, keepAnswer } from '../features/store';

export interface GuestDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** The installation ID, minted and recorded first when it is not yet. */
    id: () => Promise<string | null>;
    now?: () => number;
}

/** Asks and keeps the guest answer; null when there is no ID or API, or the answer failed. Never throws. */
export async function refreshGuestFeatures(baseUrl: string, deps: GuestDeps): Promise<Record<string, boolean> | null> {
    if (!baseUrl) return null;
    // A sign-in bumps the generation: an answer landing after it is not the account's.
    const since = accountGeneration();
    try {
        const id = await deps.id();
        if (!id) return null;
        const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/guest/features?installation=${encodeURIComponent(id)}`;
        const res = await deps.fetch(url, { method: 'GET' });
        const features = res.ok ? parseFeatures(await res.json()) : null;
        if (!features) return null;
        return (await keepAnswer(features, (deps.now ?? Date.now)(), since, 'guest')) ? features : null;
    } catch {
        return null;
    }
}
