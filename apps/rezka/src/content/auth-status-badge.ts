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

function panelBase(): HTMLDivElement {
    return el('div', { id: PANEL_ID }, {
        position: 'absolute',
        top: '100%',
        left: '0',
        marginTop: '8px',
        zIndex: '2147483647',
        background: 'rgba(25, 25, 25, 0.97)',
        backdropFilter: 'blur(8px)',
        color: '#e0e0e0',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        minWidth: '220px',
        fontSize: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'left',
    });
}

function styledInput(props: Partial<HTMLInputElement>): HTMLInputElement {
    return el('input', props, {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 9px',
        marginBottom: '6px',
        background: 'rgba(255, 255, 255, 0.06)',
        color: '#e0e0e0',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '5px',
        fontSize: '12px',
        outline: 'none',
    });
}

function primaryButton(text: string): HTMLButtonElement {
    return el('button', { textContent: text }, {
        width: '100%',
        padding: '7px 9px',
        marginTop: '2px',
        border: '0',
        borderRadius: '5px',
        background: '#4da3ff',
        color: '#0a1929',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
    });
}

function ghostButton(text: string): HTMLButtonElement {
    return el('button', { textContent: text }, {
        width: '100%',
        padding: '7px 9px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '5px',
        background: 'transparent',
        color: '#e0e0e0',
        fontSize: '12px',
        fontWeight: '500',
        cursor: 'pointer',
    });
}

function showSignInPanel(badge: HTMLElement): void {
    closePanel();
    const panel = panelBase();
    const errEl = el('div', {}, { color: '#f87171', fontSize: '11px', marginTop: '6px', display: 'none' });

    if (__EXT_ENV__ === 'dev') {
        const title = el('div', { textContent: 'Sign in (dev)' }, {
            fontWeight: '600', marginBottom: '8px', color: '#fff', fontSize: '12px',
            textTransform: 'uppercase', letterSpacing: '0.5px',
        });
        const email = styledInput({ type: 'email', placeholder: 'email', value: 'student@example.com' });
        const password = styledInput({ type: 'password', placeholder: 'password', value: 'SecurePass123!' });
        password.style.marginBottom = '10px';
        const submit = primaryButton('Sign in');
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
        const title = el('div', { textContent: 'Sign in to Lingogram' }, {
            fontWeight: '600', marginBottom: '10px', color: '#fff',
        });
        const btn = primaryButton('Sign in with Google');
        btn.style.padding = '9px 10px';
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
    const panel = panelBase();

    const label = el('div', { textContent: 'Signed in as' }, {
        color: 'rgba(255, 255, 255, 0.5)', fontSize: '10px',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px',
    });
    const email = el('div', { textContent: status.email ?? '' }, {
        fontWeight: '600', color: '#fff', wordBreak: 'break-all', marginBottom: '10px',
    });
    const count = el('div', {
        textContent: `${status.inboxCount ?? 0} words added`,
    }, { color: 'rgba(255, 255, 255, 0.5)', fontSize: '11px', marginBottom: '10px' });
    const signOut = ghostButton('Sign out');
    signOut.addEventListener('click', async () => {
        signOut.disabled = true;
        try {
            await sendMessage({ action: 'AUTH_SIGN_OUT' });
        } finally {
            closePanel();
            await render(badge);
        }
    });
    panel.append(label, email, count, signOut);
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px 4px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: '500',
        lineHeight: '1.2',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        background: 'transparent',
        color: 'rgba(255, 255, 255, 0.75)',
        whiteSpace: 'nowrap',
        maxWidth: '180px',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    });

    if (status.signedIn) {
        const dot = el('span', {}, {
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 6px rgba(34, 197, 94, 0.6)',
            flexShrink: '0',
        });
        const text = el('span', { textContent: status.email ?? 'Signed in' }, {
            overflow: 'hidden', textOverflow: 'ellipsis',
        });
        pill.append(dot, text);
        pill.title = `Lingogram — ${status.inboxCount ?? 0} words added · click to manage`;
    } else {
        pill.textContent = 'Sign in';
        pill.title = 'Sign in to save words to Lingogram';
    }

    pill.addEventListener('mouseenter', () => {
        pill.style.background = 'rgba(255, 255, 255, 0.06)';
        pill.style.color = '#fff';
        pill.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    pill.addEventListener('mouseleave', () => {
        pill.style.background = 'transparent';
        pill.style.color = 'rgba(255, 255, 255, 0.75)';
        pill.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    });

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
    // Absolute-positioned on the left of #vtt-header-top so the centred
    // "Subtitles" title stays centred (mirrors #vtt-settings-btn on the right).
    host.style.position = 'absolute';
    host.style.left = '20px';
    host.style.top = '50%';
    host.style.transform = 'translateY(-50%)';
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
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
