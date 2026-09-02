import { msg as i18nMsg } from '../i18n';
import { sendMessage } from '../messaging';

const BADGE_ID = 'lingogram-auth-badge';
const PANEL_ID = 'lingogram-auth-panel';

interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    inboxCount?: number;
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

/** "{count} words saved" in the user's locale — the same key the demo chip uses. */
function wordsSavedLabel(count: number): string {
    return i18nMsg('ytWordsSaved', '{count} words saved').replace('{count}', String(count));
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

function primaryButton(text: string): HTMLButtonElement {
    return el('button', { textContent: text, className: 'lingogram-auth-btn lingogram-auth-btn--primary' }, {
        width: '100%',
        padding: '7px 9px',
        marginTop: '2px',
        border: '1px solid var(--vtt-accent-border-strong)',
        borderRadius: '5px',
        background: 'var(--vtt-accent)',
        color: '#0a1929',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
    });
}

function ghostButton(text: string): HTMLButtonElement {
    return el('button', { textContent: text, className: 'lingogram-auth-btn' }, {
        width: '100%',
        padding: '7px 9px',
        border: '1px solid var(--vtt-hairline-strong)',
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
    const errEl = el('div', { role: 'alert' }, {
        color: 'var(--vtt-danger)', fontSize: '11px', marginTop: '6px', display: 'none',
    });

    // Always-available: open Lingogram in a new tab and let the user sign in
    // through the regular web UI; the page POSTs tokens back to us via
    // chrome.runtime.sendMessage (externally_connectable in manifest).
    const viaLingogram = primaryButton(i18nMsg('ytAuthSignInAction', 'Sign in on lingogram'));
    viaLingogram.style.padding = '9px 10px';
    viaLingogram.addEventListener('click', async () => {
        viaLingogram.disabled = true;
        errEl.style.display = 'none';
        try {
            const res = await sendMessage<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'badge' });
            if (!res.ok) throw new Error(res.error ?? i18nMsg('ytAuthOpenFailed', "Couldn't open the sign-in page. Try again."));
            closePanel();
        } catch (err) {
            errEl.textContent = String(err instanceof Error ? err.message : err);
            errEl.style.display = 'block';
            viaLingogram.disabled = false;
        }
    });

    const title = el('div', { textContent: i18nMsg('ytAuthSignInTitle', 'Sign in to Lingogram') }, {
        fontWeight: '600', marginBottom: '10px', color: '#fff',
    });
    panel.append(title, viaLingogram, errEl);
    badge.appendChild(panel);
    viaLingogram.focus();
}

function showSignedInPanel(badge: HTMLElement, status: AuthStatus): void {
    closePanel();
    const panel = panelBase();

    const label = el('div', { textContent: i18nMsg('ytAuthSignedInAs', 'Signed in as') }, {
        color: 'var(--vtt-text-dim)', fontSize: '10px',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px',
    });
    const email = el('div', { textContent: status.email ?? '' }, {
        fontWeight: '600', color: '#fff', wordBreak: 'break-all', marginBottom: '10px',
    });
    const count = el('div', {
        textContent: wordsSavedLabel(status.inboxCount ?? 0),
    }, { color: 'var(--vtt-text-dim)', fontSize: '11px', marginBottom: '10px' });
    const signOut = ghostButton(i18nMsg('ytAuthSignOut', 'Sign out'));
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
    // Promo demo: the content script sets __vttDemo (mode switched in-page without
    // a URL change); fall back to the URL for fresh-loaded demo URLs.
    const demo = (window as unknown as { __vttDemo?: { onboarding: boolean } }).__vttDemo;
    const onboarding = demo ? demo.onboarding : location.href.includes('vtt-demo-onboarding');
    if (demo || location.href.includes('vtt-demo')) {
        // Onboarding shows a sign-in prompt; the rest show a clean signed-in chip
        // that advertises the save-words feature (localized, never the real email).
        status = onboarding ? { signedIn: false } : { signedIn: true, email: wordsSavedLabel(142), inboxCount: 142 };
    } else {
        try {
            status = await sendMessage<AuthStatus>({ action: 'AUTH_STATUS' });
        } catch {
            status = { signedIn: false };
        }
    }
    badge.innerHTML = '';

    // Deliberately NOT `all: unset` — that also erases the focus outline, and
    // this row is the only way into the account panel, so a keyboard user was
    // left tabbing onto something with no visible state at all. Reset the
    // properties that actually need resetting and leave focus alone; the
    // stylesheet's #vtt-sidebar button:focus-visible rule then applies.
    const row = el('button', { type: 'button', className: 'lingogram-auth-row' }, {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        boxSizing: 'border-box',
        margin: '0',
        padding: '8px 20px',
        border: 'none',
        borderRadius: '0',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: '11px',
        fontWeight: '500',
        lineHeight: '1.2',
        color: 'var(--vtt-text-soft)',
        background: 'transparent',
        transition: 'background-color 0.15s, color 0.15s',
    });
    row.setAttribute('aria-expanded', 'false');

    const labelPrefix = el('span', { textContent: 'Lingogram' }, {
        color: 'var(--vtt-text-dim)',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        flexShrink: '0',
    });
    row.appendChild(labelPrefix);

    if (status.signedIn) {
        const dot = el('span', {}, {
            width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--vtt-success)',
            boxShadow: '0 0 6px var(--vtt-success-border)',
            flexShrink: '0',
        });
        const text = el('span', { textContent: status.email ?? i18nMsg('ytAuthSignedIn', 'Signed in') }, {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1',
            minWidth: '0',
        });
        row.append(dot, text);
        row.title = `${i18nMsg('ytAuthSignedInAs', 'Signed in as')} ${status.email} — ${wordsSavedLabel(status.inboxCount ?? 0)}`;
        row.setAttribute('aria-label', row.title);
    } else {
        const text = el('span', { textContent: i18nMsg('ytSignInToSave', 'Sign in to save words') }, {
            color: 'var(--vtt-text)',
            textDecoration: 'underline',
            textDecorationColor: 'var(--vtt-hairline-strong)',
            textUnderlineOffset: '2px',
            flex: '1',
            minWidth: '0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        });
        row.append(text);
        row.title = i18nMsg('ytSignInToSave', 'Sign in to save words');
    }

    row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255, 255, 255, 0.06)';
        row.style.color = 'var(--vtt-text)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
        row.style.color = 'var(--vtt-text-soft)';
    });

    row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.getElementById(PANEL_ID)) {
            closePanel();
            row.setAttribute('aria-expanded', 'false');
            return;
        }
        if (status.signedIn) {
            showSignedInPanel(badge, status);
        } else {
            showSignInPanel(badge);
        }
        row.setAttribute('aria-expanded', 'true');
    });

    // Escape closes the panel and returns focus to the row that opened it —
    // the panel is a popup, and a keyboard user needs a way out that isn't
    // "tab through every control in it".
    row.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !document.getElementById(PANEL_ID)) return;
        closePanel();
        row.setAttribute('aria-expanded', 'false');
        row.focus();
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

// Re-render the badge against the current state (used by the promo demo when it
// switches mode via the hash: onboarding shows a sign-in prompt, others a chip).
export function refreshAuthStatusBadge(): void {
    const badge = document.getElementById(BADGE_ID);
    if (badge) void render(badge);
}

/**
 * Returns a teardown. The extensions never call it — they live for the page's
 * lifetime — but an embed (packages/embed) can remount, and a second install
 * would stack another outside-click handler and another storage subscriber on
 * top of the first.
 */
export function installAuthStatusBadge(): () => void {
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
    // Held so teardown can disconnect it even if the sidebar never appeared —
    // otherwise this observer walks every DOM mutation for the page's lifetime.
    let observer: MutationObserver | null = null;
    if (!attached) {
        observer = new MutationObserver(() => {
            tryAttach();
            if (attached) observer?.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Close panel on outside click.
    const onMouseDown = (e: MouseEvent): void => {
        const panel = document.getElementById(PANEL_ID);
        const badge = document.getElementById(BADGE_ID);
        if (!panel) return;
        if (badge && (badge === e.target || badge.contains(e.target as Node))) return;
        closePanel();
    };
    document.addEventListener('mousedown', onMouseDown);

    // React to background-side auth changes (sign-in from popup, sign-out, ADD_WORD counter).
    const onStorageChanged = (
        changes: Record<string, unknown>,
        areaName: string,
    ): void => {
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
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    return () => {
        observer?.disconnect();
        document.removeEventListener('mousedown', onMouseDown);
        chrome.storage.onChanged.removeListener(onStorageChanged);
    };
}
