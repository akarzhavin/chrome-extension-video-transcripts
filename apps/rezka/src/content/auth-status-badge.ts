declare const __EXT_ENV__: 'dev' | 'prod';

const BADGE_ID = 'lingogram-auth-badge';
const PANEL_ID = 'lingogram-auth-panel';

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    inboxCount?: number;
}

function sendMessage<T>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(msg, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res as T);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Partial<HTMLElementTagNameMap[K]>, style?: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    if (style) Object.assign(node.style, style);
    return node;
}

function closePanel(): void {
    document.getElementById(PANEL_ID)?.remove();
}

function showSignInPanel(badge: HTMLElement): void {
    closePanel();
    const panel = el('div', { id: PANEL_ID }, {
        position: 'absolute',
        top: '100%',
        right: '0',
        marginTop: '6px',
        zIndex: '2147483647',
        background: '#ffffff',
        color: '#1f2937',
        padding: '12px',
        borderRadius: '8px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        minWidth: '220px',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'left',
    });

    const errEl = el('div', {}, { color: '#b91c1c', fontSize: '11px', marginTop: '6px', display: 'none' });

    if (__EXT_ENV__ === 'dev') {
        const title = el('div', { textContent: 'Sign in (dev)' }, { fontWeight: '600', marginBottom: '8px' });
        const email = el('input', {
            type: 'email',
            placeholder: 'email',
            value: 'student@example.com',
        }, { width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: '6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' });
        const password = el('input', {
            type: 'password',
            placeholder: 'password',
            value: 'SecurePass123!',
        }, { width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' });
        const submit = el('button', { textContent: 'Sign in' }, {
            width: '100%', padding: '6px 8px', border: '0', borderRadius: '4px',
            background: '#2563eb', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
        });
        submit.addEventListener('click', async () => {
            submit.disabled = true;
            errEl.style.display = 'none';
            try {
                const res = await sendMessage<{ ok: boolean; error?: string }>({
                    action: 'AUTH_SIGN_IN_PASSWORD',
                    email: email.value.trim(),
                    password: password.value,
                });
                if (!res.ok) throw new Error(res.error ?? 'Sign-in failed');
                closePanel();
                await render(badge);
            } catch (err) {
                errEl.textContent = String(err instanceof Error ? err.message : err);
                errEl.style.display = 'block';
                submit.disabled = false;
            }
        });
        panel.append(title, email, password, submit, errEl);
    } else {
        const title = el('div', { textContent: 'Sign in to Lingogram' }, { fontWeight: '600', marginBottom: '8px' });
        const btn = el('button', { textContent: 'Sign in with Google' }, {
            width: '100%', padding: '8px 10px', border: '0', borderRadius: '4px',
            background: '#2563eb', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
        });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            errEl.style.display = 'none';
            try {
                const res = await sendMessage<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN' });
                if (!res.ok) throw new Error(res.error ?? 'Sign-in failed');
                closePanel();
                await render(badge);
            } catch (err) {
                errEl.textContent = String(err instanceof Error ? err.message : err);
                errEl.style.display = 'block';
                btn.disabled = false;
            }
        });
        panel.append(title, btn, errEl);
    }

    badge.appendChild(panel);
}

function showSignedInPanel(badge: HTMLElement, status: AuthStatus): void {
    closePanel();
    const panel = el('div', { id: PANEL_ID }, {
        position: 'absolute',
        top: '100%',
        right: '0',
        marginTop: '6px',
        zIndex: '2147483647',
        background: '#ffffff',
        color: '#1f2937',
        padding: '12px',
        borderRadius: '8px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        minWidth: '220px',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'left',
    });

    const email = el('div', { textContent: status.email ?? '' }, { fontWeight: '600', marginBottom: '4px', wordBreak: 'break-all' });
    const count = el('div', { textContent: `${status.inboxCount ?? 0} words added` }, { color: '#6b7280', fontSize: '11px', marginBottom: '10px' });
    const signOut = el('button', { textContent: 'Sign out' }, {
        width: '100%', padding: '6px 8px', border: '0', borderRadius: '4px',
        background: '#f3f4f6', color: '#1f2937', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
    });
    signOut.addEventListener('click', async () => {
        signOut.disabled = true;
        try {
            await sendMessage({ action: 'AUTH_SIGN_OUT' });
        } finally {
            closePanel();
            await render(badge);
        }
    });
    panel.append(email, count, signOut);
    badge.appendChild(panel);
}

async function render(badge: HTMLElement): Promise<void> {
    let status: AuthStatus;
    try {
        status = await sendMessage<AuthStatus>({ action: 'AUTH_STATUS' });
    } catch {
        status = { signedIn: false };
    }
    badge.innerHTML = '';

    const pill = el('button', { type: 'button' }, {
        all: 'unset',
        cursor: 'pointer',
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: '600',
        lineHeight: '1.4',
        background: status.signedIn ? 'rgba(22,163,74,0.15)' : 'rgba(37,99,235,0.15)',
        color: status.signedIn ? '#15803d' : '#1d4ed8',
        whiteSpace: 'nowrap',
        maxWidth: '180px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block',
    });
    pill.textContent = status.signedIn
        ? `✓ ${status.email ?? 'Signed in'}`
        : 'Sign in';
    pill.title = status.signedIn ? 'Lingogram — click to manage' : 'Sign in to save words to Lingogram';

    pill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.getElementById(PANEL_ID)) {
            closePanel();
            return;
        }
        if (status.signedIn) {
            showSignedInPanel(badge, status);
        } else {
            showSignInPanel(badge);
        }
    });

    badge.appendChild(pill);
}

function ensureHostStyles(host: HTMLElement): void {
    host.style.position = 'relative';
    host.style.display = 'inline-block';
    host.style.marginLeft = '8px';
}

export function installAuthStatusBadge(): void {
    let attached = false;

    const tryAttach = (): void => {
        if (attached) return;
        const headerTop = document.getElementById('vtt-header-top');
        if (!headerTop) return;
        let badge = document.getElementById(BADGE_ID);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = BADGE_ID;
            ensureHostStyles(badge);
            // Insert before the settings button so the pill sits to the right of "Subtitles" header text.
            const settingsBtn = headerTop.querySelector('#vtt-settings-btn');
            if (settingsBtn) headerTop.insertBefore(badge, settingsBtn);
            else headerTop.appendChild(badge);
        }
        attached = true;
        render(badge);
    };

    tryAttach();
    if (!attached) {
        const observer = new MutationObserver(() => {
            tryAttach();
            if (attached) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Close panel on outside click.
    document.addEventListener('mousedown', (e) => {
        const panel = document.getElementById(PANEL_ID);
        const badge = document.getElementById(BADGE_ID);
        if (!panel) return;
        if (badge && (badge === e.target || badge.contains(e.target as Node))) return;
        closePanel();
    });

    // React to background-side auth changes (sign-in from popup, sign-out, ADD_WORD counter).
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (
            'auth.idToken' in changes ||
            'auth.email' in changes ||
            'auth.uid' in changes ||
            'inbox.count' in changes
        ) {
            const badge = document.getElementById(BADGE_ID);
            if (badge) render(badge);
        }
    });
}
