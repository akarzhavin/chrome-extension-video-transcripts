// The hover card over a marked word on any web page: point at a word the page
// highlight underlined, and the same card the subtitles have appears — its
// part of speech, its translations, and a heart that takes it off the list
// (and puts it back).
//
// Only marked words open it. Every word on a page would spend the dictionary's
// 30-requests-a-minute on a cursor crossing a paragraph, and would put our UI
// over every site's links and tooltips; a word the learner already saved is
// the one place where "what did this mean again" is the obvious question.
//
// The site's DOM is not touched. The word under the pointer comes from the
// browser's caret-at-point and the marks the highlighter already painted; the
// card lives in its own closed shadow root, so neither the site's CSS reaches
// it nor ours reaches the site.
//
// Only the word is sent to look it up — not the sentence around it. On YouTube
// the context is a subtitle line; here it would be whatever page the learner
// is reading. The sentence goes along only with an explicit "Save", exactly
// as the right-click save sends it.

import { platformOf } from '../analytics';
import { msg } from '../i18n';
import { HEART_SVG, posLabel } from '../lookup/icons';
import { hasLookupContent, posTags, showsLemma, stripDefinition, stripTranslations } from '../lookup/shape';
import type { LookupResult } from '../lookup/types';

/** A saved word under the pointer, as the card needs it. */
export interface PageMark {
    /** The saved term (its match key), which is what is looked up and saved. */
    key: string;
    /** Where the word is now, or null once it is off the page. */
    rect(): DOMRect | null;
    /** Whether the viewport point is on the word itself. */
    contains(x: number, y: number): boolean;
    /** The paragraph around the word, sent only with a Save. */
    context(): string;
}

export interface PageCardDeps {
    /** The marked word at a viewport point, or null. */
    markAtPoint(x: number, y: number): PageMark | null;
    /** Whether any word is marked on the page; when not, the pointer is not even read. */
    active(): boolean;
    /** The learner's native language, or undefined before setup. */
    nativeLang(): Promise<string | undefined>;
    send<T>(message: Record<string, unknown>): Promise<T>;
}

const HOST_ID = 'lingogram-page-card';
const HOVER_DELAY_MS = 250; // a rest, not a pass: the cursor crosses words on its way anywhere
const SPINNER_AFTER_MS = 400;
const HIDE_DELAY_MS = 140; // long enough to travel word → card
const ERROR_HIDE_MS = 2000;
const GAP_PX = 6;
const MARGIN_PX = 8;
const READ_EVERY_MS = 40;

// The subtitle card's look (apps/rezka/src/assets/lookup.css, the strip
// section), with the dark tokens it reads from styles.css written out: a
// shadow root sees no page stylesheet, ours included. Dark in every theme, as
// over the video — it floats over someone else's page, whatever its colours.
const CARD_CSS = `
:host { all: initial; }
.card {
  --text: #e9eaee; --dim: rgba(255,255,255,.62); --soft: rgba(255,255,255,.72);
  --line: rgba(255,255,255,.08); --line-strong: rgba(255,255,255,.15);
  --chip: rgba(255,255,255,.1); --accent: #7c8dff; --ring: rgba(124,141,255,.55);
  --heart: #ff7a90; --danger: #f87171;
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column;
  width: max-content; max-width: 300px; box-sizing: border-box;
  background: #1b1c20; border: 1px solid var(--line-strong); border-radius: 10px;
  box-shadow: 0 8px 26px rgba(0,0,0,.55); color: var(--text);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  visibility: hidden;
}
.card.below { flex-direction: column-reverse; }
.card::after { content: ''; position: absolute; left: 0; right: 0; height: 12px; }
.card.above::after { top: 100%; }
.card.below::after { bottom: 100%; }
.body { display: flex; flex-direction: column; gap: 4px; padding: 8px 11px 7px; overflow-wrap: anywhere; }
.pending { flex-direction: row; align-items: center; gap: 7px; color: var(--dim); font-size: 12.5px; }
.error { color: var(--danger); font-size: 12.5px; }
.muted { color: var(--dim); font-size: 12.5px; }
.spin { width: 13px; height: 13px; flex: none; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 1.6s; } }
.pos-tag { align-self: flex-start; font-size: 10.5px; font-weight: 600; color: var(--soft); background: var(--chip); padding: 2px 6px; border-radius: 4px; line-height: 1.25; white-space: nowrap; }
.tr { color: var(--text); font-weight: 500; }
.sep { color: var(--dim); margin: 0 2px; font-weight: 400; }
.def { color: var(--soft); font-size: 12.5px; max-width: 270px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lemma { font-size: 11px; color: var(--dim); }
.lemma::before { content: '→ '; }
.acts { display: flex; border-top: 1px solid var(--line); }
.card.below .acts { border-top: 0; border-bottom: 1px solid var(--line); }
.btn { flex: 1 1 0; min-height: 33px; border: 0; background: transparent; color: var(--soft); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; }
.btn:hover { background: var(--chip); color: var(--text); }
.btn:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.btn:disabled { opacity: .6; cursor: default; }
.btn svg { width: 15px; height: 15px; flex: none; }
.heart.saved { color: var(--heart); }
.heart.saved svg { fill: var(--heart); stroke: var(--heart); }
`;

interface LookupResponse {
    ok: boolean;
    result?: LookupResult;
    error?: string;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Mounts the card's listeners on `doc`; returns the uninstaller. */
export function installPageCard(deps: PageCardDeps, doc: Document = document): () => void {
    const win = doc.defaultView ?? window;
    let host: HTMLElement | null = null;
    let card: HTMLElement | null = null;
    let current: PageMark | null = null;
    let aimed: string | null = null;
    let token = 0;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let spinTimer: ReturnType<typeof setTimeout> | undefined;
    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRead = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let last: { x: number; y: number; buttons: number } | null = null;

    const site = (): string => platformOf(win.location.hostname);

    function ensureCard(): HTMLElement {
        if (card && host?.isConnected) return card;
        host = doc.createElement('div');
        host.id = HOST_ID;
        const root = host.attachShadow({ mode: 'closed' });
        const style = doc.createElement('style');
        style.textContent = CARD_CSS;
        card = doc.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'dialog');
        card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        card.addEventListener('mouseleave', () => scheduleHide());
        root.append(style, card);
        (doc.fullscreenElement ?? doc.body).appendChild(host);
        return card;
    }

    function close(): void {
        clearTimeout(spinTimer);
        clearTimeout(errorTimer);
        clearTimeout(hideTimer);
        token++;
        current = null;
        host?.remove();
        host = null;
        card = null;
    }

    function scheduleHide(): void {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(close, HIDE_DELAY_MS);
    }

    /** Heart over the word, the side facing it, clamped to the viewport — as the subtitle card does. */
    function place(el: HTMLElement, mark: PageMark): void {
        const rect = mark.rect();
        if (!rect) {
            close();
            return;
        }
        el.style.visibility = 'hidden';
        el.classList.add('above');
        el.classList.remove('below');
        let height = el.offsetHeight;
        const fitsAbove = rect.top - GAP_PX - height >= MARGIN_PX;
        if (!fitsAbove) {
            el.classList.replace('above', 'below');
            height = el.offsetHeight;
        }
        const heart = el.querySelector<HTMLElement>('.heart');
        const width = el.offsetWidth;
        const anchorOffset = heart ? heart.offsetLeft + heart.offsetWidth / 2 : width / 2;
        const left = Math.min(
            Math.max(MARGIN_PX, Math.round(rect.left + rect.width / 2 - anchorOffset)),
            Math.max(MARGIN_PX, win.innerWidth - width - MARGIN_PX),
        );
        el.style.left = `${left}px`;
        el.style.top = `${fitsAbove ? Math.round(rect.top - GAP_PX - height) : Math.round(rect.bottom + GAP_PX)}px`;
        el.style.visibility = 'visible';
    }

    function renderLoading(mark: PageMark): void {
        const el = ensureCard();
        el.innerHTML =
            `<div class="body pending"><span class="spin" aria-hidden="true"></span>` +
            `<span>${escapeHtml(msg('ytLookupLoading', 'Looking up…'))}</span></div>`;
        place(el, mark);
    }

    function renderError(mark: PageMark): void {
        const el = ensureCard();
        el.innerHTML = `<div class="body error" role="alert">${escapeHtml(msg('ytLookupError', "Couldn't load"))}</div>`;
        place(el, mark);
        clearTimeout(errorTimer);
        errorTimer = setTimeout(close, ERROR_HIDE_MS);
    }

    function heartLabel(saved: boolean): string {
        // What pressing it does next: a saved word offers "Remove".
        return saved ? msg('ytLookupRemove', 'Remove') : msg('ytLookupSave', 'Save');
    }

    function renderResult(mark: PageMark, r: LookupResult): void {
        const el = ensureCard();
        let body = '<div class="body">';
        if (!hasLookupContent(r)) {
            body += `<span class="muted">${escapeHtml(msg('ytLookupNone', 'No translation'))}</span>`;
        } else {
            const tags = posTags(r);
            if (tags.length) body += `<span class="pos-tag">${escapeHtml(posLabel(tags[0]))}</span>`;
            const translations = stripTranslations(r);
            body += translations.length
                ? `<span class="tr">${translations.map(escapeHtml).join(' <span class="sep">·</span> ')}</span>`
                : `<span class="def">${escapeHtml(stripDefinition(r))}</span>`;
            if (showsLemma(r)) body += `<span class="lemma">${escapeHtml(r.lemma)}</span>`;
        }
        body += '</div>';
        // Every marked word is a saved one, so the card opens on "Remove".
        el.innerHTML =
            body +
            `<div class="acts"><button type="button" class="btn heart saved" data-act="heart">` +
            `${HEART_SVG}<span>${escapeHtml(heartLabel(true))}</span></button></div>`;
        const btn = el.querySelector<HTMLButtonElement>('.heart')!;
        let saved = true;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            // The worker updates the mirror on success, and the highlighter
            // follows the mirror: the underline goes (or comes back) by itself.
            const res = await deps
                .send<{ ok?: boolean }>(
                    saved
                        ? { action: 'REMOVE_WORD', term: mark.key, site: site() }
                        : { action: 'ADD_WORD', term: mark.key, context: mark.context(), site: site() },
                )
                .catch(() => undefined);
            btn.disabled = false;
            if (!res?.ok) return;
            saved = !saved;
            btn.classList.toggle('saved', saved);
            btn.querySelector('span')!.textContent = heartLabel(saved);
        });
        place(el, mark);
    }

    async function open(mark: PageMark): Promise<void> {
        const native = await deps.nativeLang();
        // No native language yet means nothing to translate into.
        if (!native || aimed !== mark.key) return;
        close();
        current = mark;
        const my = token;
        clearTimeout(spinTimer);
        spinTimer = setTimeout(() => {
            if (my === token) renderLoading(mark);
        }, SPINNER_AFTER_MS);
        let res: LookupResponse | undefined;
        try {
            res = await deps.send<LookupResponse>({
                action: 'LOOKUP_WORD',
                term: mark.key,
                context: '',
                targetLang: native,
                site: site(),
            });
        } catch {
            res = undefined;
        }
        if (my !== token) return;
        clearTimeout(spinTimer);
        if (res?.ok && res.result) renderResult(mark, res.result);
        else if (res?.error === 'lookup not configured') close();
        else renderError(mark);
    }

    function onPointer(x: number, y: number, buttons: number): void {
        // A press or a drag is someone selecting text, not asking a question.
        if (buttons !== 0) {
            clearTimeout(hoverTimer);
            aimed = null;
            return;
        }
        if (!current && !deps.active()) return;
        const mark = deps.markAtPoint(x, y);
        if (mark && current && mark.key === current.key) {
            clearTimeout(hideTimer);
            return;
        }
        if (mark) {
            if (mark.key === aimed) return;
            aimed = mark.key;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => void open(mark), HOVER_DELAY_MS);
            return;
        }
        clearTimeout(hoverTimer);
        aimed = null;
        if (current) scheduleHide();
    }

    // At most one read per READ_EVERY_MS, and always the last position: a
    // cursor fires mousemove far more often than anything here needs. A timer,
    // not requestAnimationFrame — Chrome stops frames in a window another one
    // covers, and the hover would then go deaf while still being delivered.
    const readNow = (): void => {
        trailing = undefined;
        lastRead = Date.now();
        if (last) onPointer(last.x, last.y, last.buttons);
    };
    const onMouseMove = (e: MouseEvent): void => {
        if (host && e.composedPath().includes(host)) return;
        last = { x: e.clientX, y: e.clientY, buttons: e.buttons };
        if (trailing) return;
        const wait = READ_EVERY_MS - (Date.now() - lastRead);
        if (wait <= 0) readNow();
        else trailing = setTimeout(readNow, wait);
    };
    // The card is placed once, in viewport coordinates; a scroll tears the two apart.
    const onScroll = (): void => {
        if (current) close();
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && current) close();
    };
    const onDown = (e: MouseEvent): void => {
        if (host && e.composedPath().includes(host)) return;
        if (current) close();
    };

    doc.addEventListener('mousemove', onMouseMove, { passive: true });
    win.addEventListener('scroll', onScroll, { capture: true, passive: true });
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('mousedown', onDown, true);

    return () => {
        doc.removeEventListener('mousemove', onMouseMove);
        win.removeEventListener('scroll', onScroll, { capture: true });
        doc.removeEventListener('keydown', onKey);
        doc.removeEventListener('mousedown', onDown, true);
        clearTimeout(trailing);
        clearTimeout(hoverTimer);
        close();
    };
}

/** The paragraph around a range, trimmed to what a save carries. */
export function blockContext(range: AbstractRange, max = 1000): string {
    let el: Element | null = range.startContainer.parentElement;
    while (el && el.parentElement && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
