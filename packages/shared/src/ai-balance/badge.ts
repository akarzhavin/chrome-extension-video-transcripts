// The sidebar's AI badge (spec 024): in the header slot the language-pair chip
// holds, while signed in it shows a ring of today's share left and the tokens
// left (spent: a closed red ring and the reset); a click opens the two bars
// (Shift+S still swaps). Signed out there is no balance, and the chip is back.

import { msg } from '../i18n';
import { renderBars } from './bars';
import { formatTokens, isHigh, limitText, resetShort, tokensLeft } from './format';
import { loadBalance, onBalance } from './store';
import type { AIBalance } from './types';
import { takeWarning } from './warn';
import { showWarningNote } from './warning-note';

const ON = 'vtt-ai-on';
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
