import { AuthConfig } from './config';
import { refreshIdToken } from './firebaseRest';
import { AuthState, getAuthState, setAuthState } from './storage';

interface FirestoreCreatedDocument {
    name: string; // projects/.../databases/(default)/documents/inbox/<uid>/words/<wordId>
    fields: Record<string, unknown>;
    createTime: string;
    updateTime: string;
}

const REFRESH_LEEWAY_MS = 60_000;

async function ensureFreshToken(cfg: AuthConfig): Promise<AuthState> {
    const state = await getAuthState();
    if (!state) throw new Error('Not signed in');
    if (state.expiresAt > Date.now() + REFRESH_LEEWAY_MS) return state;
    const refreshed = await refreshIdToken(cfg, state.refreshToken);
    const next: AuthState = { ...state, ...refreshed };
    await setAuthState(next);
    return next;
}

interface AddInboxWordInput {
    term: string;
    sourceUrl: string;
}

interface AddInboxWordResult {
    wordId: string;
    documentPath: string;
}

export async function addInboxWord(cfg: AuthConfig, input: AddInboxWordInput): Promise<AddInboxWordResult> {
    let state = await ensureFreshToken(cfg);
    const url = `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents/inbox/${encodeURIComponent(state.uid)}/words`;
    const body = {
        fields: {
            term: { stringValue: input.term },
            source: { stringValue: 'rezka-extension' },
            sourceUrl: { stringValue: input.sourceUrl },
            addedAt: { timestampValue: new Date().toISOString() },
            processed: { booleanValue: false },
        },
    };

    let res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.idToken}`,
        },
        body: JSON.stringify(body),
    });

    if (res.status === 401) {
        const refreshed = await refreshIdToken(cfg, state.refreshToken);
        state = { ...state, ...refreshed };
        await setAuthState(state);
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.idToken}`,
            },
            body: JSON.stringify(body),
        });
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore POST ${res.status}: ${text || res.statusText}`);
    }

    const doc = (await res.json()) as FirestoreCreatedDocument;
    const wordId = doc.name.split('/').pop() ?? '';
    return { wordId, documentPath: doc.name };
}
