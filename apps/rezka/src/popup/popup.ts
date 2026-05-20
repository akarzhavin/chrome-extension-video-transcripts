import { isDev } from '../auth/config';

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    inboxCount?: number;
}

const root = document.getElementById('root')!;

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

async function refresh(): Promise<void> {
    render({ loading: true });
    try {
        const status = await send<AuthStatus>({ action: 'AUTH_STATUS' });
        render({ status });
    } catch (err) {
        render({ error: String(err) });
    }
}

interface ViewState {
    status?: AuthStatus;
    loading?: boolean;
    error?: string;
}

function render(state: ViewState): void {
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
        renderSignedIn(state.status);
    } else {
        renderSignedOut();
    }

    if (state.error) {
        const e = document.createElement('div');
        e.className = 'error';
        e.textContent = state.error;
        root.appendChild(e);
    }
}

function renderSignedIn(status: AuthStatus): void {
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
            render({ status, error: String(err) });
            return;
        }
        await refresh();
    });
    root.appendChild(out);
}

function renderSignedOut(): void {
    if (isDev) {
        renderDevSignIn();
    } else {
        renderGoogleSignIn();
    }
}

function renderGoogleSignIn(): void {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Sign in with Google';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const res = await send<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN' });
            if (!res.ok) throw new Error(res.error ?? 'Sign-in failed');
        } catch (err) {
            render({ error: String(err) });
            return;
        }
        await refresh();
    });
    root.appendChild(btn);
}

function renderDevSignIn(): void {
    const form = document.createElement('div');
    form.className = 'row';

    const email = document.createElement('input');
    email.type = 'email';
    email.placeholder = 'email';
    email.value = 'student@example.com';
    form.appendChild(email);

    const password = document.createElement('input');
    password.type = 'password';
    password.placeholder = 'password';
    password.value = 'SecurePass123!';
    form.appendChild(password);

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Sign in (dev)';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const res = await send<{ ok: boolean; error?: string }>({
                action: 'AUTH_SIGN_IN_PASSWORD',
                email: email.value.trim(),
                password: password.value,
            });
            if (!res.ok) throw new Error(res.error ?? 'Sign-in failed');
        } catch (err) {
            render({ error: String(err) });
            return;
        }
        await refresh();
    });
    form.appendChild(btn);

    root.appendChild(form);
}

refresh();
