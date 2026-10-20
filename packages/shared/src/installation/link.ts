// At a sign-in hand-off only: POST /dictionary/installations/link as the account. Not on token refreshes.

export interface LinkDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    id: () => Promise<string | null>;
}

/** linked: the server took it; refused: a 4xx that a repeat cannot change; owed: worth trying again. */
export type LinkOutcome = 'linked' | 'refused' | 'owed';

/** Links the installation to the signed-in account. Never throws, never retries later. */
export async function linkInstallation(baseUrl: string, edition: string, deps: LinkDeps): Promise<LinkOutcome> {
    if (!baseUrl) return 'owed';
    try {
        const id = await deps.id();
        if (!id) return 'owed';
        const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/installations/link`;
        const post = async (refresh: boolean) => {
            const { idToken } = await deps.token(refresh);
            return deps.fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ id, edition }),
            });
        };
        let res = await post(false);
        if (res.status === 401) res = await post(true);
        if (res.ok) return 'linked';
        console.warn('[Lingogram] installation link refused:', res.status);
        // 401 survived a fresh token, 408/429 are busy: a later sign-in may land; any other 4xx never will.
        if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) return 'refused';
    } catch (err) {
        console.warn('[Lingogram] installation link failed:', err);
    }
    return 'owed';
}
