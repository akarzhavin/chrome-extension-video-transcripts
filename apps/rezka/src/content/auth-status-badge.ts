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
        left: '12px',
        right: '12px',
        marginTop: '6px',
        zIndex: '2147483647',
        background: 'rgba(25, 25, 25, 0.97)',
        backdropFilter: 'blur(8px)',
        color: '#e0e0e0',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
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

function divider(label: string): HTMLDivElement {
    const wrap = el('div', {}, {
        display: 'flex', alignItems: 'center', gap: '8px',
        margin: '12px 0 10px',
        color: 'rgba(255, 255, 255, 0.3)', fontSize: '10px',
        textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    const lineLeft = el('div', {}, { flex: '1', height: '1px', background: 'rgba(255, 255, 255, 0.08)' });
    const lineRight = el('div', {}, { flex: '1', height: '1px', background: 'rgba(255, 255, 255, 0.08)' });
    wrap.append(lineLeft, el('span', { textContent: label }), lineRight);
    return wrap;
}

function showSignInPanel(badge: HTMLElement): void {
    closePanel();
    const panel = panelBase();
    const errEl = el('div', {}, { color: '#f87171', fontSize: '11px', marginTop: '6px', display: 'none' });

    // Always-available: open Lingogram in a new tab and let the user sign in
    // through the regular web UI; the page POSTs tokens back to us via
    // chrome.runtime.sendMessage (externally_connectable in manifest).
    const viaLingogram = primaryButton('Sign in on lingogram');
    viaLingogram.style.padding = '9px 10px';
    viaLingogram.addEventListener('click', async () => {
        viaLingogram.disabled = true;
        errEl.style.display = 'none';
        try {
            const res = await sendMessage<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM' });
            if (!res.ok) throw new Error(res.error ?? 'Failed to open auth tab');
            closePanel();
        } catch (err) {
            errEl.textContent = String(err instanceof Error ? err.message : err);
            errEl.style.display = 'block';
            viaLingogram.disabled = false;
        }
    });

    const title = el('div', { textContent: 'Sign in to Lingogram' }, {
        fontWeight: '600', marginBottom: '10px', color: '#fff',
    });
    panel.append(title, viaLingogram);

    if (__EXT_ENV__ === 'dev') {
        panel.append(divider('or dev quick-login'));
        const email = styledInput({ type: 'email', placeholder: 'email', value: 'student@example.com' });
        const password = styledInput({ type: 'password', placeholder: 'password', value: 'SecurePass123!' });
        password.style.marginBottom = '10px';
        const submit = ghostButton('Sign in with seeded user');
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
        panel.append(email, password, submit);
    } else {
        panel.append(divider('or'));
        const googleBtn = ghostButton('Sign in with Google (native)');
        googleBtn.addEventListener('click', async () => {
            googleBtn.disabled = true;
            errEl.style.display = 'none';
            try {
                const res = await sendMessage<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN' });
                if (!res.ok) throw new Error(res.error ?? 'Sign-in failed');
                closePanel();
                await render(badge);
            } catch (err) {
                errEl.textContent = String(err instanceof Error ? err.message : err);
                errEl.style.display = 'block';
                googleBtn.disabled = false;
            }
        });
        panel.append(googleBtn);
    }

    panel.append(errEl);
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

    const row = el('button', { type: 'button' }, {
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 20px',
        fontSize: '11px',
        fontWeight: '500',
        lineHeight: '1.2',
        color: 'rgba(255, 255, 255, 0.55)',
        background: 'transparent',
        transition: 'background 0.15s, color 0.15s',
    });

    const labelPrefix = el('span', { textContent: 'Lingogram' }, {
        color: 'rgba(255, 255, 255, 0.35)',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        flexShrink: '0',
    });
    row.appendChild(labelPrefix);

    if (status.signedIn) {
        const dot = el('span', {}, {
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 6px rgba(34, 197, 94, 0.5)',
            flexShrink: '0',
        });
        const text = el('span', { textContent: status.email ?? 'Signed in' }, {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1',
            minWidth: '0',
        });
        row.append(dot, text);
        row.title = `Signed in as ${status.email} — ${status.inboxCount ?? 0} words added · click to manage`;
    } else {
        const text = el('span', { textContent: 'Sign in to save words' }, {
            color: 'rgba(255, 255, 255, 0.75)',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(255, 255, 255, 0.2)',
            textUnderlineOffset: '2px',
            flex: '1',
            minWidth: '0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        });
        row.append(text);
        row.title = 'Sign in to save words to Lingogram';
    }

    row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255, 255, 255, 0.04)';
        row.style.color = 'rgba(255, 255, 255, 0.85)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
        row.style.color = 'rgba(255, 255, 255, 0.55)';
    });

    row.addEventListener('click', (e) => {
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

    badge.appendChild(row);
}

function ensureHostStyles(host: HTMLElement): void {
    // Full-width strip below #vtt-header-top, above the settings panel.
    // Keeps the "Subtitles" title untouched and avoids horizontal contention.
    host.style.position = 'relative';
    host.style.display = 'block';
    host.style.width = '100%';
    host.style.borderTop = '1px solid rgba(255, 255, 255, 0.04)';
    host.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
}

export function installAuthStatusBadge(): void {
    let attached = false;

    const tryAttach = (): void => {
        if (attached) return;
        const header = document.getElementById('vtt-header');
        const headerTop = document.getElementById('vtt-header-top');
        if (!header || !headerTop) return;
        let badge = document.getElementById(BADGE_ID);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = BADGE_ID;
            ensureHostStyles(badge);
            // Insert as a thin strip directly below the title row, above the
            // (collapsible) settings panel. Avoids fighting the centred title
            // for horizontal space.
            headerTop.insertAdjacentElement('afterend', badge);
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
