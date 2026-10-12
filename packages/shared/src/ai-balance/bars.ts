import { msg } from '../i18n';
import { formatTokens, isHigh, percentLeft, resetsAtText, resetsOnText, tokensLeft } from './format';
import type { AIBalance, AIWindow } from './types';

/**
 * The badge dropdown: today and this month in "left", like the badge, each with
 * its reset, then the demo-mode line. Plain DOM with lg-ai-* classes.
 */
export function renderBars(b: AIBalance, doc: Document = document): HTMLElement {
    const root = doc.createElement('div');
    root.className = 'lg-ai-bars';
    root.appendChild(
        bar(doc, msg('aiToday', 'Today'), b.day, b.warnRatio, resetsAtText(b.day),
            msg('aiLimitDayShort', 'AI limit for today reached')),
    );
    root.appendChild(
        bar(doc, msg('aiMonth', 'This month'), b.month, b.warnRatio, resetsOnText(b.month),
            msg('aiLimitMonthShort', 'AI limit for this month reached')),
    );
    const demo = doc.createElement('div');
    demo.className = 'lg-ai-demo';
    demo.textContent = msg('aiDemoNote', 'Demo mode · AI is free within these limits');
    root.appendChild(demo);
    return root;
}

function bar(doc: Document, label: string, w: AIWindow, warnRatio: number, reset: string, spentText: string): HTMLElement {
    const left = percentLeft(w);
    const spent = w.limit <= 0 || w.used >= w.limit;
    const el = (tag: string, cls: string, text?: string) => {
        const e = doc.createElement(tag);
        e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };
    const row = el('div', `lg-ai-row${spent ? ' lg-ai-spent' : ''}`);
    const head = el('div', 'lg-ai-head');
    const value = el('span', 'lg-ai-value', `${left}% `);
    value.appendChild(el('span', 'lg-ai-unit', msg('aiLeft', 'left')));
    head.append(el('span', 'lg-ai-label', label), value);
    const track = el('div', 'lg-ai-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${label}: ${msg('aiLeft', 'left')}`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(left));
    const fill = el('div', `lg-ai-fill${spent ? ' lg-ai-full' : isHigh(w, warnRatio) ? ' lg-ai-high' : ''}`);
    fill.style.width = `${left}%`;
    track.appendChild(fill);
    const amount = spent
        ? spentText
        : msg('aiOfLimit', '$1 of $2', [formatTokens(tokensLeft(w)), formatTokens(w.limit)]);
    const foot = el('div', 'lg-ai-foot');
    foot.append(el('span', 'lg-ai-amount', amount), el('span', 'lg-ai-reset', reset));
    row.append(head, track, foot);
    return row;
}
