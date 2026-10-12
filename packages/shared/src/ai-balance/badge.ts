// The sidebar's AI badge (spec 024): in the header slot the language-pair chip
// holds, while signed in it shows today's tokens left; a click opens the two
// bars, with the swap the chip used to be (Shift+S still swaps). Signed out
// there is no balance, and the chip is back.

import { msg } from '../i18n';
import { renderBars } from './bars';
import { formatTokens, limitText, tokensLeft } from './format';
import { loadBalance, onBalance } from './store';
import type { AIBalance } from './types';
import { takeWarning } from './warn';
import { showWarningNote } from './warning-note';

const ON = 'vtt-ai-on';

/** Asks the worker for the balance once, as the sidebar opens; answered by a storage write. */
function requestRefresh(): void {
    try {
        chrome.runtime.sendMessage({ action: 'AI_BALANCE_REFRESH' }, () => void chrome.runtime.lastError);
    } catch {
        /* orphaned context: the badge stays as it is */
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
    badge.appendChild(button);
    headerTop.prepend(badge);

    let balance: AIBalance | null = null;
    let panel: HTMLElement | null = null;
    let cancelWarning = () => {};
    let disposed = false;

    const close = () => {
        panel?.remove();
        panel = null;
        button.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
        if (!balance) return;
        panel = doc.createElement('div');
        panel.id = 'vtt-ai-panel';
        panel.setAttribute('role', 'dialog');
        panel.appendChild(renderBars(balance, doc));
        const chip = doc.getElementById('vtt-langpair');
        if (chip) {
            const swap = doc.createElement('button');
            swap.type = 'button';
            swap.className = 'vtt-ai-swap';
            swap.textContent = `${chip.textContent?.trim() ?? ''} · ${msg('ytModeSwap', 'Swap')} (Shift+S)`;
            swap.addEventListener('click', () => chip.click());
            panel.appendChild(swap);
        }
        badge.appendChild(panel);
        button.setAttribute('aria-expanded', 'true');
    };
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel) close();
        else open();
    });
    const outside = (e: Event) => {
        if (panel && !badge.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    doc.addEventListener('click', outside, true);
    doc.addEventListener('keydown', escape);

    const show = (b: AIBalance | null) => {
        balance = b;
        headerTop.classList.toggle(ON, !!b);
        if (!b) {
            close();
            return;
        }
        const out = b.exhausted !== null;
        badge.classList.toggle('vtt-ai-out', out);
        button.textContent = `AI ${formatTokens(tokensLeft(b.day))}`;
        button.title = out ? limitText(b.exhausted ?? 'day', b) : msg('aiBadgeTitle', 'AI tokens left today');
        button.setAttribute('aria-label', button.title);
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
    return () => {
        disposed = true;
        unsubscribe();
        cancelWarning();
        doc.removeEventListener('click', outside, true);
        doc.removeEventListener('keydown', escape);
        badge.remove();
        headerTop.classList.remove(ON);
    };
}
