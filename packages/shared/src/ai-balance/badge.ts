// The sidebar's AI badge (spec 024), at the header's left edge. Signed in it
// shows a ring of today's share left and the tokens left (spent: a closed red
// ring and the reset), and a click opens the two bars. Signed out it is the
// same badge switched off: the server's default daily allowance in grey (just
// "AI" until the worker has read it), and a hover or
// a click opens a panel saying AI needs a sign-in and that the tokens are
// free every day, with a quiet "Sign in" link. Signed in without a balance
// yet (the first read in flight, or refused) it is hidden.

import { AUTH_STATE_KEYS, getAuthState } from '../auth/storage';
import { msg } from '../i18n';
import { renderBars } from './bars';
import { formatTokens, isHigh, limitText, resetShort, tokensLeft } from './format';
import { loadBalance, loadDefaults, onBalance, onDefaults } from './store';
import type { AIBalance, AIDefaults } from './types';
import { takeWarning } from './warn';
import { showWarningNote } from './warning-note';

const ON = 'vtt-ai-on';
/** Signed out: the badge switched off. */
const OFF = 'vtt-ai-off';
const SVG = 'http://www.w3.org/2000/svg';
const R = 7;
const C = 2 * Math.PI * R;

/** The 18px ring: a track and an arc drawn clockwise from 12 o'clock. */
function ring(doc: Document): { svg: SVGSVGElement; arc: SVGCircleElement } {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'vtt-ai-ring');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls: string) => {
        const c = doc.createElementNS(SVG, 'circle');
        c.setAttribute('class', cls);
        for (const [k, v] of [['cx', '9'], ['cy', '9'], ['r', String(R)]]) c.setAttribute(k, v);
        svg.appendChild(c);
        return c;
    };
    circle('vtt-ai-track');
    return { svg, arc: circle('vtt-ai-arc') };
}

/** Asks the worker for the balance once, as the sidebar opens; answered by a storage write. */
function requestRefresh(): void {
    try {
        chrome.runtime.sendMessage({ action: 'AI_BALANCE_REFRESH' }, () => void chrome.runtime.lastError);
    } catch {
        /* orphaned context: the badge stays as it is */
    }
}

/** Starts the sign-in, as the account row and the word card do. */
function startSignIn(): void {
    try {
        chrome.runtime.sendMessage({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'ai_badge' }, () => void chrome.runtime.lastError);
    } catch {
        /* orphaned context: nothing to start */
    }
}

/** Whether an account is signed in, by the worker's own rule (getAuthState), so the two never disagree. */
async function readSignedIn(): Promise<boolean> {
    try {
        return (await getAuthState()) !== null;
    } catch {
        return false;
    }
}

/** Mounts the badge into the sidebar header; returns the unmount. */
export function mountAIBadge(headerTop: HTMLElement): () => void {
    const doc = headerTop.ownerDocument;
    const badge = doc.createElement('div');
    badge.id = 'vtt-ai-badge';
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    const { svg, arc } = ring(doc);
    const label = doc.createElement('span');
    button.append(svg, label);
    badge.appendChild(button);
    headerTop.prepend(badge);

    let balance: AIBalance | null = null;
    let signedIn: boolean | null = null; // null until read: no chip flashes before we know
    let defaults: AIDefaults | null = null; // the server's default windows, for the signed-out badge
    let panel: HTMLElement | null = null;
    let cancelWarning = () => {};
    let disposed = false;

    const close = () => {
        panel?.remove();
        panel = null;
        button.setAttribute('aria-expanded', 'false');
    };
    // Signed out: why the badge is off, and a quiet link that starts the sign-in.
    const renderSignedOut = (): HTMLElement => {
        const box = doc.createElement('div');
        box.className = 'lg-ai-off';
        const text = doc.createElement('p');
        text.className = 'lg-ai-off-text';
        text.textContent = msg('aiSignInToUse', 'Sign in, and AI will translate phrases from the subtitles and complete word cards');
        box.appendChild(text);
        // Only a number the server gave: no line rather than a made-up one.
        if (defaults) {
            const free = doc.createElement('p');
            free.className = 'lg-ai-off-free';
            free.textContent = msg('aiFreeDaily', '{count} free tokens a day').replace('{count}', formatTokens(defaults.day));
            box.appendChild(free);
        }
        const link = doc.createElement('button');
        link.type = 'button';
        link.className = 'lg-ai-signin';
        link.textContent = msg('aiChipSignIn', 'Sign in');
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            startSignIn();
        });
        box.appendChild(link);
        return box;
    };
    const open = () => {
        if (!balance && signedIn !== false) return;
        panel = doc.createElement('div');
        panel.id = 'vtt-ai-panel';
        panel.setAttribute('role', 'dialog');
        panel.appendChild(balance ? renderBars(balance, doc) : renderSignedOut());
        badge.appendChild(panel);
        button.setAttribute('aria-expanded', 'true');
    };
    // Signed out, the panel also opens on hover; a click pins it so moving the
    // mouse away does not close it. Signed in, hover shows the [data-tip]
    // bubble and only a click opens the bars.
    let pinned = false;
    let hoverClose: ReturnType<typeof setTimeout> | undefined;
    const isOff = () => !balance && signedIn === false;
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(hoverClose);
        if (panel && (pinned || !isOff())) {
            close();
            pinned = false;
            return;
        }
        if (!panel) open();
        pinned = isOff();
    });
    badge.addEventListener('mouseenter', () => {
        clearTimeout(hoverClose);
        if (isOff() && !panel) open();
    });
    badge.addEventListener('mouseleave', () => {
        if (!isOff() || pinned) return;
        // The panel hangs 8px below the button: a short grace lets the mouse cross the gap.
        hoverClose = setTimeout(() => {
            if (!pinned) close();
        }, 150);
    });
    const outside = (e: Event) => {
        if (panel && !badge.contains(e.target as Node)) {
            close();
            pinned = false;
        }
    };
    const escape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            close();
            pinned = false;
        }
    };
    doc.addEventListener('click', outside, true);
    doc.addEventListener('keydown', escape);

    // Signed out and no balance: the badge switched off, showing the default
    // daily allowance; the panel explains and links to the sign-in.
    const showSignedOut = () => {
        const off = !balance && signedIn === false;
        headerTop.classList.toggle(OFF, off);
        if (!off) {
            if (!balance && panel) {
                close();
                pinned = false;
            }
            return;
        }
        badge.classList.remove('vtt-ai-out', 'vtt-ai-high');
        arc.setAttribute('stroke-dasharray', `${C.toFixed(2)} ${C.toFixed(2)}`);
        label.textContent = defaults ? `AI ${formatTokens(defaults.day)}` : 'AI';
        if (panel) {
            close();
            open();
        }
        // No [data-tip] bubble here: hover opens the panel itself.
        button.removeAttribute('data-tip');
        button.setAttribute('aria-label', msg('aiSignInToUse', 'Sign in, and AI will translate phrases from the subtitles and complete word cards'));
        button.setAttribute('aria-haspopup', 'true');
    };

    const show = (b: AIBalance | null) => {
        balance = b;
        headerTop.classList.toggle(ON, !!b);
        if (!b) {
            close();
            showSignedOut();
            return;
        }
        headerTop.classList.remove(OFF);
        const spent = b.exhausted;
        badge.classList.toggle('vtt-ai-out', spent !== null);
        badge.classList.toggle('vtt-ai-high', spent === null && isHigh(b.day, b.warnRatio));
        const share = spent !== null || b.day.limit <= 0 ? 1 : tokensLeft(b.day) / b.day.limit;
        arc.setAttribute('stroke-dasharray', `${(share * C).toFixed(2)} ${C.toFixed(2)}`);
        label.textContent = `AI ${spent !== null ? resetShort(spent, b) : formatTokens(tokensLeft(b.day))}`;
        const what = spent !== null ? limitText(spent, b) : msg('aiBadgeTitle', 'AI tokens left today');
        // The panel's [data-tip] bubble: shows at once and on focus, unlike title.
        const tip = `${what}\n${msg('aiBadgeDemo', 'Demo mode: AI is free within a daily and a monthly limit')}`;
        button.setAttribute('data-tip', tip);
        button.setAttribute('aria-label', tip);
        if (panel) {
            close();
            open();
        }
        void takeWarning(b).then((w) => {
            if (!w || disposed) return;
            cancelWarning();
            cancelWarning = showWarningNote(headerTop, w);
        });
    };

    void loadBalance().then(show);
    requestRefresh();
    const unsubscribe = onBalance(show);
    const applyDefaults = (d: AIDefaults | null) => {
        if (disposed) return;
        defaults = d;
        showSignedOut();
    };
    void loadDefaults().then(applyDefaults);
    const unsubscribeDefaults = onDefaults(applyDefaults);
    // Every check re-reads storage and only the latest one lands, so a slow
    // first read cannot overwrite a sign-in that happened while it was in flight.
    let check = 0;
    const checkSignedIn = () => {
        const mine = ++check;
        void readSignedIn().then((now) => {
            if (disposed || mine !== check) return;
            const signedInNow = signedIn !== true && now;
            signedIn = now;
            showSignedOut();
            // A sign-in while the sidebar is open: ask for the balance right away.
            if (signedInNow && mine > 1) requestRefresh();
        });
    };
    checkSignedIn();
    const onAuth = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || disposed || !AUTH_STATE_KEYS.some((k) => k in changes)) return;
        checkSignedIn();
    };
    try {
        chrome.storage.onChanged.addListener(onAuth);
    } catch {
        /* orphaned context */
    }
    return () => {
        disposed = true;
        clearTimeout(hoverClose);
        unsubscribe();
        unsubscribeDefaults();
        try {
            chrome.storage.onChanged.removeListener(onAuth);
        } catch {
            /* orphaned context */
        }
        cancelWarning();
        doc.removeEventListener('click', outside, true);
        doc.removeEventListener('keydown', escape);
        badge.remove();
        headerTop.classList.remove(ON, OFF);
    };
}
