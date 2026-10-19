// At a sign-in hand-off only: POST /dictionary/installations/link as the account. Not on token refreshes.

export interface LinkDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    id: () => Promise<string | null>;
}

/** Links the installation to the signed-in account; true when the server took it. Never throws, never retries later. */
export async function linkInstallation(baseUrl: string, edition: string, deps: LinkDeps): Promise<boolean> {
    if (!baseUrl) return false;
    try {
        const id = await deps.id();
        if (!id) return false;
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
        if (res.ok) return true;
        console.warn('[Lingogram] installation link refused:', res.status);
    } catch (err) {
        console.warn('[Lingogram] installation link failed:', err);
    }
    return false;
}
