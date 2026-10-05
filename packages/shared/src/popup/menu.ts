// The toolbar popup's rows. A plain menu: every row is 36px, a 16px stroke
// icon in the dim colour, a label, then a value and a chevron (or a switch).
// Rows that act are real <button>s, so the whole row is the hit area and the
// keyboard and screen reader get the native control.

import { el } from './shared';

export type MenuIcon = 'book' | 'pen' | 'sliders' | 'user' | 'flag';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 16x16 stroke icons, one family; the shapes are inline so the popup needs no asset.
const PATHS: Record<MenuIcon, string[]> = {
    book: ['M8 4.3C6.8 3.3 5 2.9 2.5 3.1v9c2.5-.2 4.3.2 5.5 1.2 1.2-1 3-1.4 5.5-1.2v-9C11 2.9 9.2 3.3 8 4.3z', 'M8 4.3v9'],
    pen: ['M9.5 3l3.5 3.5-6 6H3.5V9z', 'M2 14.5h12'],
    sliders: ['M2.5 5h5.2M12.3 5h1.2M2.5 11h1.2M8.3 11h5.2'],
    user: ['M2.8 13.6a5.2 5.2 0 0110.4 0'],
    flag: ['M4 14V2.5', 'M4 3h8l-2 3 2 3H4'],
};
const CIRCLES: Partial<Record<MenuIcon, Array<[number, number, number]>>> = {
    sliders: [
        [10, 5, 1.8],
        [6, 11, 1.8],
    ],
    user: [[8, 5.5, 2.6]],
};

function svg(className: string | undefined, strokeWidth: string): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, 'svg');
    if (className) s.setAttribute('class', className);
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', strokeWidth);
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    return s;
}

function path(d: string): SVGPathElement {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    return p;
}

export function menuIcon(name: MenuIcon): SVGSVGElement {
    const s = svg(undefined, '1.4');
    for (const d of PATHS[name]) s.appendChild(path(d));
    for (const [cx, cy, r] of CIRCLES[name] ?? []) {
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', String(cx));
        c.setAttribute('cy', String(cy));
        c.setAttribute('r', String(r));
        s.appendChild(c);
    }
    return s;
}

function chevron(): SVGSVGElement {
    const s = svg('chev', '1.6');
    s.appendChild(path('M6 3.5l4.5 4.5L6 12.5'));
    return s;
}

/** Accent-coloured text inside a label ("Sign in" in "Sign in to keep them…"). */
export function accent(text: string): HTMLElement {
    return el('span', 'acc', text);
}

export interface RowSpec {
    icon: MenuIcon;
    /** Plain text, or nodes when part of the label is accent-coloured. */
    label: string | Node[];
    /** Right-aligned, before the chevron. */
    value?: string;
    chevron?: boolean;
    /** The whole label in the accent colour. */
    accent?: boolean;
    onClick: () => void;
}

/** A row that acts: a full-width button. */
export function menuRow(spec: RowSpec): HTMLButtonElement {
    const row = el('button', 'mi');
    row.type = 'button';
    const label = el('span', spec.accent ? 'l acc' : 'l');
    if (typeof spec.label === 'string') label.textContent = spec.label;
    else label.append(...spec.label);
    row.append(menuIcon(spec.icon), label);
    if (spec.value !== undefined) row.appendChild(el('span', 'v2', spec.value));
    if (spec.chevron) row.appendChild(chevron());
    row.addEventListener('click', spec.onClick);
    return row;
}

/** A row that only shows something (the highlight row); `trailing` is its switch. */
export function staticRow(icon: MenuIcon, label: HTMLElement, trailing?: HTMLElement): HTMLElement {
    const row = el('div', 'mi static');
    row.append(menuIcon(icon), label);
    if (trailing) row.appendChild(trailing);
    return row;
}

/** The small line under a row, indented to its label. */
export function subLine(...parts: Array<string | Node>): HTMLElement {
    const line = el('div', 'msub');
    line.append(...parts);
    return line;
}

/** A text link inside a sub-line. */
export function inlineLink(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'lnk', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
