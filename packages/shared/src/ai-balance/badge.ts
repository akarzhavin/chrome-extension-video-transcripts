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

const STYLE_ID = 'vtt-ai-badge-style';
const ON = 'vtt-ai-on';
const WARN_MS = 8000;

const CSS = `
#vtt-header-top.${ON} #vtt-langpair { display: none; }
#vtt-ai-badge { position: absolute; left: 16px; display: none; -webkit-user-select: none; user-select: none; }
#vtt-header-top.${ON} #vtt-ai-badge { display: flex; }
#vtt-ai-badge button {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
    background: rgba(124, 90, 255, 0.16); border: 1px solid rgba(124, 90, 255, 0.32);
    color: #e3e5ff; font: 600 12px/1.2 inherit; cursor: pointer;
}
#vtt-ai-badge button:hover { background: rgba(124, 90, 255, 0.28); }
#vtt-ai-badge.vtt-ai-out button { background: rgba(239, 68, 68, 0.16); border-color: rgba(239, 68, 68, 0.4); }
#vtt-ai-panel {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; width: 240px; padding: 12px;
    border-radius: 12px; background: #1f2230; border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); color: #e8e9f3; font-size: 12px;
}
#vtt-ai-panel .lg-ai-row { margin-bottom: 10px; }
#vtt-ai-panel .lg-ai-head { display: flex; justify-content: space-between; font-weight: 600; }
#vtt-ai-panel .lg-ai-track { height: 6px; margin: 5px 0 3px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
#vtt-ai-panel .lg-ai-fill { height: 100%; border-radius: 3px; background: #8b7bff; }
#vtt-ai-panel .lg-ai-fill.lg-ai-high { background: #f2b488; }
#vtt-ai-panel .lg-ai-fill.lg-ai-full { background: #f87171; }
#vtt-ai-panel .lg-ai-reset, #vtt-ai-panel .lg-ai-note { opacity: 0.7; }
#vtt-ai-panel .lg-ai-note { margin-bottom: 8px; }
#vtt-ai-panel .vtt-ai-swap {
    width: 100%; margin-top: 2px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
    background: transparent; border: 1px solid rgba(255, 255, 255, 0.18); color: inherit; font: inherit;
}
#vtt-ai-warn {
    margin: 6px 16px 0; padding: 6px 10px; border-radius: 8px; font-size: 12px;
    background: rgba(242, 180, 136, 0.16); border: 1px solid rgba(242, 180, 136, 0.4); color: #f7d9c2;
}
`;

function ensureStyle(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
}

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
    ensureStyle(doc);
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
        void takeWarning(b).then((w) => w && warn(headerTop, w));
    };

    void loadBalance().then(show);
    requestRefresh();
    const unsubscribe = onBalance(show);
    return () => {
        unsubscribe();
        doc.removeEventListener('click', outside, true);
        doc.removeEventListener('keydown', escape);
        badge.remove();
        headerTop.classList.remove(ON);
    };
}

function warn(headerTop: HTMLElement, window: 'day' | 'month'): void {
    const doc = headerTop.ownerDocument;
    doc.getElementById('vtt-ai-warn')?.remove();
    const note = doc.createElement('div');
    note.id = 'vtt-ai-warn';
    note.setAttribute('role', 'status');
    note.textContent =
        window === 'month'
            ? msg('aiWarnMonth', 'AI is almost used up for this month')
            : msg('aiWarnDay', 'AI is almost used up for today');
    headerTop.after(note);
    setTimeout(() => note.remove(), WARN_MS);
}
