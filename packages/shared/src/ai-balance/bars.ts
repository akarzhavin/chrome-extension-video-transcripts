import { msg } from '../i18n';
import { isHigh, limitText, percentUsed, resetsAtText, resetsOnText } from './format';
import type { AIBalance, AIWindow } from './types';

/**
 * Two bars, today and this month, with each window's reset. Plain DOM with
 * lg-ai-* classes; each view styles them (sidebar, popup).
 */
export function renderBars(b: AIBalance, doc: Document = document): HTMLElement {
    const root = doc.createElement('div');
    root.className = 'lg-ai-bars';
    root.appendChild(bar(doc, msg('aiToday', 'Today'), b.day, b.warnRatio, resetsAtText(b.day)));
    root.appendChild(bar(doc, msg('aiMonth', 'This month'), b.month, b.warnRatio, resetsOnText(b.month)));
    if (b.exhausted) {
        const note = doc.createElement('div');
        note.className = 'lg-ai-note';
        note.textContent = limitText(b.exhausted, b);
        root.appendChild(note);
    }
    return root;
}

function bar(doc: Document, label: string, w: AIWindow, warnRatio: number, reset: string): HTMLElement {
    const pct = percentUsed(w);
    const row = doc.createElement('div');
    row.className = 'lg-ai-row';
    const head = doc.createElement('div');
    head.className = 'lg-ai-head';
    const name = doc.createElement('span');
    name.className = 'lg-ai-label';
    name.textContent = label;
    const value = doc.createElement('span');
    value.className = 'lg-ai-value';
    value.textContent = `${pct}%`;
    head.append(name, value);
    const track = doc.createElement('div');
    track.className = 'lg-ai-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(pct));
    track.title = `${w.used.toLocaleString()} / ${w.limit.toLocaleString()}`;
    const fill = doc.createElement('div');
    fill.className = `lg-ai-fill${pct >= 100 ? ' lg-ai-full' : isHigh(w, warnRatio) ? ' lg-ai-high' : ''}`;
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    const foot = doc.createElement('div');
    foot.className = 'lg-ai-reset';
    foot.textContent = reset;
    row.append(head, track, foot);
    return row;
}
