// The AI badge signed out (spec 024): the same badge switched off. It shows
// the server's default daily allowance in grey (just "AI" until the worker has
// read it); a hover or a click opens a panel saying AI needs a sign-in and that
// the tokens are free every day, with a quiet "Sign in" link. Everything about
// that state lives here; badge.ts only asks isOff(), paint(), panel(), click().

import { AUTH_STATE_KEYS, getAuthState } from '../auth/storage';
import { msg } from '../i18n';
import { formatTokens } from './format';
import { loadLimits, onLimits } from './store';
import type { AILimits } from './types';

/** On the header: the badge switched off. */
const OFF = 'vtt-ai-off';

/** What the badge lends this mode: its parts and its panel shell. */
export interface OffHost {
    headerTop: HTMLElement;
    badge: HTMLElement;
    button: HTMLButtonElement;
    label: HTMLElement;
    arc: SVGCircleElement;
    /** The full ring's circumference, for a closed grey ring. */
    circumference: number;
    hasBalance(): boolean;
    isOpen(): boolean;
    open(): void;
    close(): void;
    /** A sign-in landed while the badge is mounted: the balance is wanted now. */
    signedIn(): void;
}

export interface OffMode {
    /** Signed out and no balance: the badge is off. */
    isOff(): boolean;
    /** Paints the off look, or leaves it; call on every change of the balance. */
    paint(): void;
    /** The panel's content while off. */
    panel(doc: Document): HTMLElement;
    /** Handles a click while off (open, pin, unpin); false when not off. */
    click(): boolean;
    /** An outside click or Escape closed the panel: unpin. */
    reset(): void;
    dispose(): void;
}

/** Whether an account is signed in, by the worker's own rule (getAuthState), so the two never disagree. */
async function readSignedIn(): Promise<boolean> {
    try {
        return (await getAuthState()) !== null;
    } catch {
        return false;
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

export function offMode(host: OffHost): OffMode {
    const { headerTop, badge, button, label, arc } = host;
    let signedIn: boolean | null = null; // null until read: no off badge flashes before we know
    let limits: AILimits | null = null;
    let pinned = false;
    let hoverClose: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const isOff = () => !host.hasBalance() && signedIn === false;
    const text = () => msg('aiSignInToUse', 'Sign in, and AI will translate phrases from the subtitles and complete word cards');

    const paint = () => {
        const off = isOff();
        headerTop.classList.toggle(OFF, off);
        if (!off) {
            if (!host.hasBalance() && host.isOpen()) {
                host.close();
                pinned = false;
            }
            return;
        }
        badge.classList.remove('vtt-ai-out', 'vtt-ai-high');
        arc.setAttribute('stroke-dasharray', `${host.circumference.toFixed(2)} ${host.circumference.toFixed(2)}`);
        label.textContent = limits ? `AI ${formatTokens(limits.day)}` : 'AI';
        if (host.isOpen()) {
            host.close();
            host.open();
        }
        // No [data-tip] bubble here: hover opens the panel itself.
        button.removeAttribute('data-tip');
        button.setAttribute('aria-label', text());
    };

    const panel = (doc: Document): HTMLElement => {
        const box = doc.createElement('div');
        const why = doc.createElement('p');
        why.className = 'lg-ai-off-text';
        why.textContent = text();
        box.appendChild(why);
        // Only a number the server gave: no line rather than a made-up one.
        if (limits) {
            const free = doc.createElement('p');
            free.className = 'lg-ai-off-free';
            free.textContent = msg('aiFreeDaily', '{count} free tokens a day').replace('{count}', formatTokens(limits.day));
            box.appendChild(free);
        }
        const link = doc.createElement('button');
        link.type = 'button';
        link.className = 'lg-ai-signin';
        link.textContent = msg('aiBadgeSignIn', 'Sign in');
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            startSignIn();
        });
        box.appendChild(link);
        return box;
    };

    // Hover opens the panel; a click pins it so moving the mouse away does not
    // close it, and a second click closes it.
    const click = (): boolean => {
        if (!isOff()) return false;
        clearTimeout(hoverClose);
        if (host.isOpen() && pinned) {
            host.close();
            pinned = false;
            return true;
        }
        if (!host.isOpen()) host.open();
        pinned = true;
        return true;
    };
    const enter = () => {
        clearTimeout(hoverClose);
        if (isOff() && !host.isOpen()) host.open();
    };
    const leave = () => {
        if (!isOff() || pinned) return;
        // The panel hangs 8px below the button: a short grace lets the mouse cross the gap.
        hoverClose = setTimeout(() => {
            if (!pinned) host.close();
        }, 150);
    };
    badge.addEventListener('mouseenter', enter);
    badge.addEventListener('mouseleave', leave);

    const applyLimits = (d: AILimits | null) => {
        if (disposed) return;
        limits = d;
        paint();
    };
    void loadLimits().then(applyLimits);
    const unsubscribeLimits = onLimits(applyLimits);

    // Every check re-reads storage and only the latest one lands, so a slow
    // first read cannot overwrite a sign-in that happened while it was in flight.
    let check = 0;
    const checkSignedIn = () => {
        const mine = ++check;
        void readSignedIn().then((now) => {
            if (disposed || mine !== check) return;
            const justSignedIn = signedIn !== true && now;
            signedIn = now;
            paint();
            // The first check is the mount, which asks for the balance itself.
            if (justSignedIn && mine > 1) host.signedIn();
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

    return {
        isOff,
        paint,
        panel,
        click,
        reset: () => {
            pinned = false;
        },
        dispose: () => {
            disposed = true;
            clearTimeout(hoverClose);
            unsubscribeLimits();
            try {
                chrome.storage.onChanged.removeListener(onAuth);
            } catch {
                /* orphaned context */
            }
            badge.removeEventListener('mouseenter', enter);
            badge.removeEventListener('mouseleave', leave);
            headerTop.classList.remove(OFF);
        },
    };
}
