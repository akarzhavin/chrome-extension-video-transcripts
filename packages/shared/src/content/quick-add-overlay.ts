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
            background: var(--vtt-accent-quiet, rgba(124,141,255,0.16));
            box-shadow: inset 0 -2px 0 var(--vtt-accent, #7c8dff);
        }
        .vtt-saved-badge {
            /* inline-block so the margin actually separates it from the word:
               as a plain inline the badge butted straight against the last
               glyph ("teeming✓ saved"), because the word spans carry no
               trailing whitespace of their own. */
            display: inline-block;
            margin: 0 4px 0 7px; padding: 1px 7px; border-radius: 999px;
            font-size: 10px; font-weight: 700; vertical-align: middle;
            white-space: nowrap;
            color: var(--vtt-success-text, #6ee7b7);
            background: var(--vtt-success-quiet, rgba(52,211,153,0.16));
            border: 1px solid var(--vtt-success-border, rgba(52,211,153,0.4));
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
    // The result of saving a word is announced, not just shown: this is the
    // only confirmation the action worked, and it disappears in 2.5s. Errors
    // interrupt ('assertive'); a successful save waits its turn ('polite').
    t.setAttribute('role', ok ? 'status' : 'alert');
    t.setAttribute('aria-live', ok ? 'polite' : 'assertive');
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        maxWidth: 'min(360px, calc(100vw - 40px))',
        padding: '10px 14px',
        borderRadius: '8px',
        background: ok ? 'rgba(6,78,59,0.96)' : 'rgba(127,29,29,0.96)',
        border: `1px solid ${ok ? 'var(--vtt-success-border)' : 'rgba(248,113,113,0.45)'}`,
        color: '#fff',
        fontSize: '13px',
        fontFamily: 'var(--vtt-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
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

// Styles live in an injected sheet (same pattern as injectSavedWordStyles)
// because the card needs :hover states and an entrance animation — neither is
// expressible as inline styles. Every value is lifted from the sidebar's own
// system (apps/rezka/src/assets/styles.css): the panel base, the neutral
// action pills, the --vtt-accent token, the 12px/#9ca3af body. The card reads as
// Lingogram UI because it is built from Lingogram's parts.
function injectRatePromptStyles(): void {
    if (document.getElementById('lingogram-rate-style')) return;
    const style = document.createElement('style');
    style.id = 'lingogram-rate-style';
    style.textContent = `
        @keyframes lingogram-rate-in {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: none; }
        }
        #${RATE_ID} {
            position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
            width: 268px; padding: 16px; box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            background: #191919;
            color: #e5e7eb; font-size: 12px; line-height: 1.5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
            animation: lingogram-rate-in 0.22s cubic-bezier(0.23, 1, 0.32, 1);
        }
        @media (prefers-reduced-motion: reduce) {
            #${RATE_ID} { animation-name: none; }
        }
        #${RATE_ID} .lingogram-rate-title {
            font-size: 15px; font-weight: 600; color: #f3f4f6; margin-bottom: 6px;
        }
        #${RATE_ID} .lingogram-rate-text {
            font-size: 12px; line-height: 1.5; color: #9ca3af;
        }
        #${RATE_ID} .lingogram-rate-row {
            display: flex; justify-content: flex-end; align-items: center;
            gap: 8px; margin-top: 14px;
        }
        #${RATE_ID} .lingogram-rate-action {
            display: inline-block; line-height: 1.5;
            padding: 6px 12px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.06);
            color: #f3f4f6;
            font-size: 12px; font-weight: 600; font-family: inherit;
            cursor: pointer;
            transition: background 0.2s, transform 0.16s cubic-bezier(0.23, 1, 0.32, 1);
        }
        #${RATE_ID} .lingogram-rate-action:hover { background: rgba(255, 255, 255, 0.12); }
        #${RATE_ID} .lingogram-rate-action:active { transform: scale(0.97); }
        #${RATE_ID} .lingogram-rate-action--primary {
            border-color: var(--vtt-accent-border-strong, rgba(124,141,255,0.55));
            background: var(--vtt-accent-quiet, rgba(124,141,255,0.16));
            color: #dbeafe;
            text-decoration: none;
        }
        #${RATE_ID} .lingogram-rate-action--primary:hover { background: var(--vtt-accent-hover, rgba(124,141,255,0.3)); }
        #${RATE_ID} .lingogram-rate-action:focus-visible {
            outline: 2px solid var(--vtt-accent-ring, rgba(124,141,255,0.55)); outline-offset: 2px;
        }
        #${RATE_ID} .lingogram-rate-later {
            padding: 6px 8px; border: 0; border-radius: 6px; cursor: pointer;
            background: transparent; color: #9ca3af;
            font-size: 12px; font-family: inherit; transition: color 0.15s;
        }
        #${RATE_ID} .lingogram-rate-later:hover { color: #f3f4f6; }
        #${RATE_ID} .lingogram-rate-input {
            display: block; box-sizing: border-box;
            width: 100%; margin-top: 10px; padding: 8px 10px;
            min-height: 68px; max-height: 160px; resize: vertical;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 6px;
            background: #1f1f1f; color: #f3f4f6;
            font-size: 12px; line-height: 1.5; font-family: inherit;
            transition: border-color 0.15s;
        }
        #${RATE_ID} .lingogram-rate-input::placeholder { color: #6b7280; }
        #${RATE_ID} .lingogram-rate-input:focus {
            outline: none; border-color: var(--vtt-accent, #7c8dff);
        }
        #${RATE_ID} .lingogram-rate-counter {
            margin-right: auto;
            font-size: 11px; font-variant-numeric: tabular-nums;
            color: #9ca3af;
        }
        #${RATE_ID} .lingogram-rate-action[disabled] {
            opacity: 0.5; cursor: default;
        }
        #${RATE_ID} .lingogram-rate-action[disabled]:hover {
            background: rgba(77, 163, 255, 0.16);
        }
    `;
    (document.head ?? document.documentElement).appendChild(style);
}

// The question line names the product ("Enjoying Lingogram?"), so the card
// needs no wordmark row of its own — the copy is the branding.
function rateTitle(content: string): HTMLElement {
    const title = document.createElement('div');
    title.className = 'lingogram-rate-title';
    title.textContent = content;
    return title;
}

function rateText(content: string): HTMLElement {
    const text = document.createElement('div');
    text.className = 'lingogram-rate-text';
    text.textContent = content;
    return text;
}

// Step 1: "Enjoying it?" — a yes/no gate so users who aren't happy never get
// pointed at the store's review form (the classic rating funnel). "Yes" leads
// to the ask step; "not really" just thanks them and closes.
function renderRateAskStep(card: HTMLElement, url: string): void {
    const row = document.createElement('div');
    row.className = 'lingogram-rate-row';

    const no = document.createElement('button');
    no.className = 'lingogram-rate-action';
    no.textContent = i18nMsg('ytRateNo', 'Not really');
    no.addEventListener('click', () => renderRateFeedbackStep(card));

    const yes = document.createElement('button');
    yes.className = 'lingogram-rate-action lingogram-rate-action--primary';
    yes.textContent = i18nMsg('ytRateYes', 'Yes!');
    yes.addEventListener('click', () => renderRateStoreStep(card, url));

    row.append(no, yes);
    card.replaceChildren(
        rateTitle(i18nMsg('ytRateQ', 'Enjoying Lingogram?')),
        rateText(i18nMsg('ytRateQSub', "You've been saving words with it for a while.")),
        row,
    );
}

// Firestore counts UTF-8 BYTES, while a textarea's maxLength counts UTF-16
// code units — so a 2000-char Russian message is 4000 bytes and would be
// silently halved on send. Clamp on the real budget instead, and do it here
// rather than importing the auth module's truncateBytes: that would pull the
// whole Firestore/token stack into the content bundle for one helper.
const MAX_FEEDBACK_BYTES = __LIMIT_MAX_FEEDBACK_TEXT_BYTES__;

function utf8Len(s: string): number {
    return new TextEncoder().encode(s).length;
}

/** Longest prefix of `s` that fits in `maxBytes`, never splitting a surrogate pair. */
function clampToBytes(s: string, maxBytes: number): string {
    if (utf8Len(s) <= maxBytes) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (utf8Len(s.slice(0, mid)) <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    // Step back off a lone high surrogate — TextEncoder turns it into U+FFFD
    // (3 bytes), which the search above would otherwise accept as valid.
    while (lo > 0) {
        const code = s.charCodeAt(lo - 1);
        if (code >= 0xd800 && code <= 0xdbff) lo--;
        else break;
    }
    return s.slice(0, lo);
}

// Shown for two seconds, then the card closes itself. Used by both endings.
function renderRateClosing(card: HTMLElement, message: string): void {
    const line = rateText(message);
    line.setAttribute('role', 'status');
    card.replaceChildren(line);
    setTimeout(() => card.remove(), 2000);
}

// The "not really" branch. A dead end here would waste the one moment an
// unhappy user is willing to talk, so the card asks what's wrong and takes the
// answer inline — no mail client, no sign-in, no extra page. Sending is
// deliberately best-effort and never blocks the user from just closing.
function renderRateFeedbackStep(card: HTMLElement): void {
    const input = document.createElement('textarea');
    input.className = 'lingogram-rate-input';
    input.rows = 3;
    input.placeholder = i18nMsg('ytRateFeedbackHint', 'What went wrong? What would you change?');
    input.setAttribute('aria-label', i18nMsg('ytRateFeedbackHint', 'What went wrong? What would you change?'));

    const row = document.createElement('div');
    row.className = 'lingogram-rate-row';

    const skip = document.createElement('button');
    skip.className = 'lingogram-rate-later';
    skip.textContent = i18nMsg('ytRateSkip', 'Skip');
    skip.addEventListener('click', () => card.remove());

    // Only appears once the message is near the byte ceiling — a counter that
    // is always on would read as a limit to hit rather than one to ignore.
    const counter = document.createElement('div');
    counter.className = 'lingogram-rate-counter';
    counter.hidden = true;
    counter.setAttribute('aria-live', 'polite');

    const send = document.createElement('button');
    send.className = 'lingogram-rate-action lingogram-rate-action--primary';
    send.textContent = i18nMsg('ytRateSend', 'Send');
    send.disabled = true;
    input.addEventListener('input', () => {
        // Hard-clamp on the real budget. Typing past the cap stops adding
        // characters instead of letting the send path silently halve the text.
        if (utf8Len(input.value) > MAX_FEEDBACK_BYTES) {
            const caret = input.selectionStart ?? input.value.length;
            const clamped = clampToBytes(input.value, MAX_FEEDBACK_BYTES);
            const dropped = input.value.length - clamped.length;
            input.value = clamped;
            const next = Math.max(0, caret - dropped);
            input.setSelectionRange(next, next);
        }
        const left = MAX_FEEDBACK_BYTES - utf8Len(input.value);
        counter.hidden = left > 200;
        counter.textContent = String(left);
        send.disabled = input.value.trim().length === 0;
    });
    // Enter sends, Shift+Enter makes a newline — the message is usually one line.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !send.disabled) {
            e.preventDefault();
            send.click();
        }
    });

    send.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        send.textContent = i18nMsg('ytRateSending', 'Sending…');
        try {
            const res = await sendMessage<{ ok: boolean }>({
                action: 'SEND_FEEDBACK',
                text,
                site: location.hostname,
                version: chrome.runtime.getManifest().version,
                locale: chrome.i18n?.getUILanguage?.() ?? '',
            });
            if (!res?.ok) throw new Error('send failed');
            renderRateClosing(card, i18nMsg('ytRateFeedbackSent', 'Thank you, this really helps.'));
        } catch {
            // Don't make the user retype: keep the text, let them try again.
            send.disabled = false;
            send.textContent = i18nMsg('ytRateSend', 'Send');
            const err = card.querySelector('.lingogram-rate-error')
                ?? (() => {
                    const e = rateText(i18nMsg('ytRateFeedbackFailed', "Couldn't send. Try again?"));
                    e.className = 'lingogram-rate-text lingogram-rate-error';
                    e.setAttribute('role', 'alert');
                    card.insertBefore(e, row);
                    return e;
                })();
            (err as HTMLElement).style.marginTop = '8px';
        }
    });

    row.append(counter, skip, send);
    card.replaceChildren(
        rateTitle(i18nMsg('ytRateFeedbackTitle', 'What would make it better?')),
        input,
        row,
    );
    input.focus();
}

// Step 2, only after an explicit yes. A plain link to the store's review page:
// the rating itself is entered there. Showing pickable stars here would promise
// a choice this card cannot carry — the URL takes no score, so every star would
// open the same page and the user would have to rate again anyway.
function renderRateStoreStep(card: HTMLElement, url: string): void {
    const row = document.createElement('div');
    row.className = 'lingogram-rate-row';

    const later = document.createElement('button');
    later.className = 'lingogram-rate-later';
    later.textContent = i18nMsg('ytRateLater', 'Not now');
    later.addEventListener('click', () => card.remove());

    const rate = document.createElement('a');
    rate.className = 'lingogram-rate-action lingogram-rate-action--primary';
    rate.textContent = i18nMsg('ytRateButton', 'Rate it');
    rate.href = url;
    rate.target = '_blank';
    rate.rel = 'noopener noreferrer';
    rate.addEventListener('click', () => card.remove());

    row.append(later, rate);
    card.replaceChildren(
        rateTitle(i18nMsg('ytRateThanksYes', 'Glad to hear it')),
        rateText(i18nMsg('ytRateStep2', 'A quick rating on the Web Store helps others find it.')),
        row,
    );
}

function showRatePrompt(): void {
    const url = reviewUrl();
    if (!url) return; // no runtime id (e.g. promo demo) — silently skip
    injectRatePromptStyles();
    document.getElementById(RATE_ID)?.remove();

    const card = document.createElement('div');
    card.id = RATE_ID;
    renderRateAskStep(card, url);
    (document.fullscreenElement ?? document.body).appendChild(card);
}

// Half the pill's own width, used to centre it over the selection before
// clamping. The pill is sized by its content, so this is an estimate that only
// has to be close — the clamp below is what guarantees it stays on screen.
const PILL_HALF_WIDTH = 50;
const PILL_MARGIN = 8;

function showPill(rect: DOMRect, term: string, context: string): void {
    removePill();
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.textContent = i18nMsg('ytQuickAddPill', '+ Lingogram');

    // Clamp to the viewport on both axes. Selecting the first word of a line
    // near the left edge used to push the pill off-screen (centre − 50 goes
    // negative), and selecting in the on-screen overlay near the top of the
    // video put it above y=0 — in both cases the only way to save the word
    // vanished. Below the selection is the fallback when there's no room above.
    const left = Math.min(
        Math.max(PILL_MARGIN, Math.round(rect.left + rect.width / 2 - PILL_HALF_WIDTH)),
        window.innerWidth - PILL_HALF_WIDTH * 2 - PILL_MARGIN,
    );
    const above = Math.round(rect.top - 32);
    const top = above >= PILL_MARGIN ? above : Math.round(rect.bottom + 8);

    Object.assign(pill.style, {
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: '2147483647',
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid var(--vtt-accent-border-strong, rgba(124,141,255,0.55))',
        background: 'var(--vtt-accent, #7c8dff)',
        color: '#0a1129',
        fontSize: '12px',
        fontWeight: '600',
        fontFamily: 'var(--vtt-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
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
            showToast(i18nMsg('ytQuickAddSaved', 'Saved: {term}').replace('{term}', term), true);
            markSpansSaved(savedSpans);
            // Drop the range so the overlay's selection-guard releases and
            // resumes timeupdate rebuilds.
            window.getSelection()?.removeAllRanges();
            // Value-moment rating ask (P1.8) — background signals the one-shot.
            if (res.promptRate) showRatePrompt();
        } catch (err) {
            const msg = String(err instanceof Error ? err.message : err);
            const friendly = /Not signed in|sign in via/i.test(msg)
                ? i18nMsg('ytQuickAddNeedsSignIn', 'Sign in via the Lingogram row above the subtitle list to save words.')
                : /reloaded/i.test(msg)
                ? msg
                : i18nMsg('ytQuickAddFailed', "Couldn't save: {error}").replace('{error}', msg);
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

// The rating prompt normally fires once per install, after 30 saved words — so
// there is no way to look at it again without wiping chrome.storage. Append
// `lingogram_rate=1` to the URL (query or hash: YouTube keeps the query,
// HDrezka strips it but keeps the hash — see applyDevLocaleOverride) to render
// the real card on demand. Compiled out of prod builds via the __EXT_ENV__
// guard, and it neither bumps the counter nor burns the one-shot flag.
function applyDevRatePromptOverride(): void {
    if (__EXT_ENV__ !== 'dev') return;
    if (!/[?#&]lingogram_rate=1\b/.test(location.href)) return;
    showRatePrompt();
    console.log('[dev] rate prompt forced via lingogram_rate=1');
}

/**
 * Returns a teardown. The extensions live for the page's lifetime and can
 * ignore it, but an embed (packages/embed) may remount — and without unbinding,
 * a second install leaves two `mouseup` handlers, so one selection shows the
 * pill twice and the two `mousedown` handlers race to remove it.
 */
export function installQuickAddOverlay(): () => void {
    injectSavedWordStyles();
    applyDevRatePromptOverride();
    const onMouseUp = (): void => {
        // Defer so that selection is finalized after click on existing pill clearing it.
        setTimeout(() => {
            const payload = getSelectionPayload();
            if (!payload || payload.term.length > MAX_TERM_LEN) {
                removePill();
                return;
            }
            showPill(payload.rect, payload.term.toLowerCase(), payload.context);
        }, 0);
    };
    document.addEventListener('mouseup', onMouseUp);

    const onMouseDown = (e: MouseEvent): void => {
        const pill = document.getElementById(PILL_ID);
        if (pill && !pill.contains(e.target as Node)) {
            removePill();
        }
    };
    document.addEventListener('mousedown', onMouseDown);

    return () => {
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mousedown', onMouseDown);
    };
}
