import { msg as i18nMsg } from '../i18n';

const PILL_ID = 'lingogram-quick-add-pill';
const TOAST_ID = 'lingogram-quick-add-toast';
const MAX_TERM_LEN = 256;

// Selection is only accepted when it lives entirely inside one of these
// containers — never the translation row (.vtt-sub-text) or unrelated page DOM.
const SELECTION_SCOPE_SELECTOR = '.vtt-main-text, .vtt-overlay-main';

interface SelectionPayload {
    term: string;
    rect: DOMRect;
    context: string;
}

function getSelectionPayload(): SelectionPayload | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);

    const startScope = scopeFor(range.startContainer);
    const endScope = scopeFor(range.endContainer);
    if (!startScope || startScope !== endScope) return null;

    // Snap to whole-word boundaries so the user doesn't need pixel-perfect drags.
    const snapped = snapToWordSpans(range, startScope);
    if (snapped) {
        sel.removeAllRanges();
        sel.addRange(snapped);
    }
    const active = snapped ?? range;

    const term = extractTerm(active, startScope);
    if (!term) return null;

    const rect = active.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    const context = buildContextFromScope(startScope);
    return { term, rect, context };
}

// Expand the range to cover every [data-word] span it touches. Returns null
// when the selection lies in pure whitespace (no spans intersected) so the
// caller can decide to drop the pill.
function snapToWordSpans(range: Range, scope: Element): Range | null {
    const spans = scope.querySelectorAll<HTMLElement>('span[data-word]');
    let first: HTMLElement | null = null;
    let last: HTMLElement | null = null;
    spans.forEach((span) => {
        if (!range.intersectsNode(span)) return;
        if (!first) first = span;
        last = span;
    });
    if (!first || !last) return null;

    const snapped = document.createRange();
    snapped.setStart(first, 0);
    snapped.setEnd(last, (last as HTMLElement).childNodes.length);
    return snapped;
}

function scopeFor(node: Node): Element | null {
    const el = node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    return el?.closest(SELECTION_SCOPE_SELECTOR) ?? null;
}

// Prefer the real word stored on each span via data-word — this resolves
// masked *** tokens back to the underlying word. Plain-mode text nodes have
// no spans, so fall back to the visible selection string.
function extractTerm(range: Range, scope: Element): string {
    const spans = scope.querySelectorAll<HTMLElement>('span[data-word]');
    const words: string[] = [];
    spans.forEach((span) => {
        if (range.intersectsNode(span)) {
            const w = span.dataset.word?.trim();
            if (w) words.push(w);
        }
    });
    const joined = words.join(' ').trim();
    if (joined) return joined;
    return range.toString().trim();
}

// Builds a multi-line context block: previous subtitle, the subtitle holding
// the selection, then the next subtitle — all in the main language. The
// sidebar's #vtt-list is the source of truth even when the user selects in
// the on-screen overlay (which only renders one line at a time).
function buildContextFromScope(scope: Element): string {
    const indexAttr =
        scope.classList.contains('vtt-overlay-main')
            ? scope.getAttribute('data-index')
            : scope.closest('.vtt-item')?.getAttribute('data-index') ?? null;
    if (indexAttr === null) return '';
    const index = parseInt(indexAttr, 10);
    if (!Number.isFinite(index)) return '';

    const list = document.getElementById('vtt-list');
    if (!list) return '';

    const lines: string[] = [];
    for (const offset of [-1, 0, 1]) {
        const text = readMainText(list, index + offset);
        if (text) lines.push(text);
    }
    return lines.join('\n');
}

function readMainText(list: HTMLElement, index: number): string {
    const item = list.querySelector(`.vtt-item[data-index="${index}"]`);
    if (!item) return '';
    const main = item.querySelector('.vtt-main-text');
    if (!main) return '';
    const spans = main.querySelectorAll<HTMLElement>('span[data-word]');
    if (spans.length === 0) return (main.textContent ?? '').trim();
    const words: string[] = [];
    spans.forEach((s) => {
        const w = s.dataset.word?.trim();
        if (w) words.push(w);
    });
    return words.join(' ');
}

function removePill(): void {
    document.getElementById(PILL_ID)?.remove();
}

// ── "✓ saved" marker ──────────────────────────────────────────────────────
// After a word is saved we tag it inline in the transcript so the action has
// visible feedback (until the list next re-renders). Same classes are reused by
// the promo demo so the screenshots reflect a real feature.
function injectSavedWordStyles(): void {
    if (document.getElementById('lingogram-saved-style')) return;
    const style = document.createElement('style');
    style.id = 'lingogram-saved-style';
    style.textContent = `
        .vtt-saved-word {
            border-radius: 4px; padding: 0 2px;
            background: rgba(77,163,255,0.18);
            box-shadow: inset 0 -2px 0 rgba(77,163,255,0.85);
        }
        .vtt-saved-badge {
            margin-left: 7px; padding: 1px 7px; border-radius: 999px;
            font-size: 10px; font-weight: 700; vertical-align: middle;
            white-space: nowrap;
            color: #86efac;
            background: rgba(34,197,94,0.16);
            border: 1px solid rgba(34,197,94,0.4);
        }
    `;
    (document.head ?? document.documentElement).appendChild(style);
}

function selectionWordSpans(): HTMLElement[] {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    const scope = scopeFor(range.startContainer);
    if (!scope) return [];
    return Array.from(scope.querySelectorAll<HTMLElement>('span[data-word]')).filter((s) =>
        range.intersectsNode(s),
    );
}

/** Tag the given word spans as saved (highlight + a single "✓ saved" badge). */
export function markSpansSaved(spans: HTMLElement[]): void {
    if (!spans.length) return;
    spans.forEach((s) => s.classList.add('vtt-saved-word'));
    const last = spans[spans.length - 1];
    if (last.nextElementSibling?.classList.contains('vtt-saved-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'vtt-saved-badge';
    badge.textContent = `✓ ${i18nMsg('ytSavedBadge', 'saved')}`;
    last.insertAdjacentElement('afterend', badge);
}

function showToast(text: string, ok: boolean): void {
    document.getElementById(TOAST_ID)?.remove();
    const t = document.createElement('div');
    t.id = TOAST_ID;
    t.textContent = text;
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        padding: '10px 14px',
        borderRadius: '8px',
        background: ok ? 'rgba(22,163,74,0.95)' : 'rgba(185,28,28,0.95)',
        color: '#fff',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    } as CSSStyleDeclaration);
    (document.fullscreenElement ?? document.body).appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

// Value-moment rating prompt (P1.8). Shown once, ever, when the background
// reports the saved-word threshold was crossed. Rendered over the current
// surface (fullscreen-aware) so it's visible right where the value happened.
// "Rate" opens the extension's own Web Store review page — the URL is built
// from chrome.runtime.id at runtime, so it's correct for whichever edition
// this bundle ships in without hardcoding a store id.
const RATE_ID = 'lingogram-rate-prompt';

function reviewUrl(): string | null {
    try {
        const id = chrome?.runtime?.id;
        if (!id) return null;
        return `https://chromewebstore.google.com/detail/${id}/reviews`;
    } catch {
        return null;
    }
}

function showRatePrompt(): void {
    const url = reviewUrl();
    if (!url) return; // no runtime id (e.g. promo demo) — silently skip
    document.getElementById(RATE_ID)?.remove();

    const card = document.createElement('div');
    card.id = RATE_ID;
    Object.assign(card.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        maxWidth: '300px',
        padding: '14px 16px',
        borderRadius: '12px',
        background: 'rgba(30,27,75,0.97)',
        color: '#fff',
        fontSize: '13px',
        lineHeight: '1.45',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        border: '1px solid rgba(129,140,248,0.35)',
    } as CSSStyleDeclaration);

    const text = document.createElement('div');
    text.textContent = i18nMsg(
        'ytRatePromptText',
        'Enjoying Lingogram? A quick rating on the Web Store helps others find it.',
    );
    text.style.marginBottom = '12px';

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' } as CSSStyleDeclaration);

    const later = document.createElement('button');
    later.textContent = i18nMsg('ytRateLater', 'Not now');
    Object.assign(later.style, {
        padding: '6px 12px', borderRadius: '8px', border: '0', cursor: 'pointer',
        background: 'transparent', color: 'rgba(255,255,255,0.75)',
        fontSize: '13px', fontFamily: 'inherit',
    } as CSSStyleDeclaration);
    later.addEventListener('click', () => card.remove());

    const rate = document.createElement('a');
    rate.textContent = i18nMsg('ytRateButton', 'Rate it');
    rate.href = url;
    rate.target = '_blank';
    rate.rel = 'noopener noreferrer';
    Object.assign(rate.style, {
        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
        background: '#818cf8', color: '#1e1b4b', textDecoration: 'none',
        fontSize: '13px', fontWeight: '700', fontFamily: 'inherit',
    } as CSSStyleDeclaration);
    rate.addEventListener('click', () => card.remove());

    row.append(later, rate);
    card.append(text, row);
    (document.fullscreenElement ?? document.body).appendChild(card);
}

function showPill(rect: DOMRect, term: string, context: string): void {
    removePill();
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.textContent = '+ Lingogram';
    Object.assign(pill.style, {
        position: 'fixed',
        left: `${Math.round(rect.left + rect.width / 2 - 50)}px`,
        top: `${Math.round(rect.top - 32)}px`,
        zIndex: '2147483647',
        padding: '4px 10px',
        borderRadius: '999px',
        border: '0',
        background: '#2563eb',
        color: '#fff',
        fontSize: '12px',
        fontWeight: '600',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    } as CSSStyleDeclaration);

    pill.addEventListener('mousedown', (e) => {
        // Prevent selection collapse before click fires.
        e.preventDefault();
    });

    pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Snapshot the selected spans now — the click may clear the selection.
        const savedSpans = selectionWordSpans();
        pill.disabled = true;
        pill.textContent = '…';
        console.log('[Lingogram] ADD_WORD →', term);
        try {
            const res = await sendMessage<{ ok: boolean; error?: string; wordId?: string; promptRate?: boolean }>({
                action: 'ADD_WORD',
                term,
                context,
            });
            console.log('[Lingogram] ADD_WORD ←', res);
            if (!res.ok) throw new Error(res.error ?? 'add failed');
            showToast(`Added: ${term}`, true);
            markSpansSaved(savedSpans);
            // Drop the range so the overlay's selection-guard releases and
            // resumes timeupdate rebuilds.
            window.getSelection()?.removeAllRanges();
            // Value-moment rating ask (P1.8) — background signals the one-shot.
            if (res.promptRate) showRatePrompt();
        } catch (err) {
            const msg = String(err instanceof Error ? err.message : err);
            const friendly = /Not signed in|sign in via/i.test(msg)
                ? 'Sign in via the Lingogram badge above the subtitle list.'
                : /reloaded/i.test(msg)
                ? msg
                : `Failed: ${msg}`;
            showToast(friendly, false);
            console.warn('[Lingogram] add failed:', err);
        } finally {
            removePill();
        }
    });

    (document.fullscreenElement ?? document.body).appendChild(pill);
}

function sendMessage<T>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        // Stale content scripts left over from an extension reload still have
        // a `chrome` global, but `chrome.runtime.id` flips to undefined.
        if (!chrome?.runtime?.id) {
            reject(new Error('Extension was reloaded — refresh this page to use Lingogram again.'));
            return;
        }
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

export function installQuickAddOverlay(): void {
    injectSavedWordStyles();
    document.addEventListener('mouseup', () => {
        // Defer so that selection is finalized after click on existing pill clearing it.
        setTimeout(() => {
            const payload = getSelectionPayload();
            if (!payload || payload.term.length > MAX_TERM_LEN) {
                removePill();
                return;
            }
            showPill(payload.rect, payload.term.toLowerCase(), payload.context);
        }, 0);
    });

    document.addEventListener('mousedown', (e) => {
        const pill = document.getElementById(PILL_ID);
        if (pill && !pill.contains(e.target as Node)) {
            removePill();
        }
    });
}
