import { isDev } from '../auth/config';

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    inboxCount?: number;
}

function send<T = unknown>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (res) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(res as T);
        });
    });
}

interface ViewState {
    status?: AuthStatus;
    loading?: boolean;
    error?: string;
}

function render(root: HTMLElement, state: ViewState): void {
    root.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Lingogram';
    if (isDev) {
        const badge = document.createElement('span');
        badge.className = 'env-badge';
        badge.textContent = 'dev';
        title.appendChild(badge);
    }
    root.appendChild(title);

    if (state.loading) {
        const p = document.createElement('div');
        p.textContent = 'Loading…';
        root.appendChild(p);
        return;
    }

    if (state.status?.signedIn) {
        renderSignedIn(root, state.status);
    } else {
        renderSignedOut(root);
    }

    if (state.error) {
        const e = document.createElement('div');
        e.className = 'error';
        e.textContent = state.error;
        root.appendChild(e);
    }
}

async function refresh(root: HTMLElement): Promise<void> {
    render(root, { loading: true });
    try {
        const status = await send<AuthStatus>({ action: 'AUTH_STATUS' });
        render(root, { status });
    } catch (err) {
        render(root, { error: String(err) });
    }
}

function renderSignedIn(root: HTMLElement, status: AuthStatus): void {
    const email = document.createElement('div');
    email.className = 'email';
    email.textContent = status.email ?? '(unknown email)';
    root.appendChild(email);

    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = `${status.inboxCount ?? 0} words added`;
    root.appendChild(count);

    const out = document.createElement('button');
    out.className = 'secondary';
    out.textContent = 'Sign out';
    out.addEventListener('click', async () => {
        out.disabled = true;
        try {
            await send({ action: 'AUTH_SIGN_OUT' });
        } catch (err) {
            render(root, { status, error: String(err) });
            return;
        }
        await refresh(root);
    });
    root.appendChild(out);
}

function renderSignedOut(root: HTMLElement): void {
    const primary = document.createElement('button');
    primary.className = 'primary';
    primary.textContent = 'Sign in on lingogram';
    primary.addEventListener('click', async () => {
        primary.disabled = true;
        try {
            const res = await send<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM' });
            if (!res.ok) throw new Error(res.error ?? 'Failed to open auth tab');
            window.close();
        } catch (err) {
            render(root, { error: String(err) });
            return;
        }
    });
    root.appendChild(primary);
}

export function initPopup(): void {
    const root = document.getElementById('root');
    if (!root) {
        console.error('[Lingogram] popup: #root not found');
        return;
    }
    refresh(root);
}
