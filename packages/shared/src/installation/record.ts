// POST /dictionary/installations: no token. The caller decides when, and keeps that it landed.

export interface RecordDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/** Sends the record; true when the server took it. Never throws. */
export async function postInstallation(
    baseUrl: string,
    record: { id: string; edition: string; fresh: boolean },
    deps: RecordDeps,
): Promise<boolean> {
    if (!baseUrl) return false;
    try {
        const res = await deps.fetch(`${baseUrl.replace(/\/+$/, '')}/dictionary/installations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        });
        return res.ok;
    } catch {
        return false;
    }
}
