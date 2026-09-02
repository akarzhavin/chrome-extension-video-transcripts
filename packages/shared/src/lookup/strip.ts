// The hover strip: point at a word in the subtitles and a small card appears
// with its part-of-speech tags and translations, a heart that saves it, and
// "More" opening the sidebar's word screen.
//
// Three deliberate design decisions, each carrying a constraint from outside:
//
//  - The trigger differs per surface. Over the video, hovering a caption word
//    opens the strip AND pauses playback — the line is about to scroll away,
//    and reading a translation while it does is impossible. In the sidebar the
//    transcript is already static, so hover would fire on every word the
//    cursor crosses while scrolling; there the strip opens on CLICK instead,
//    and playback is left alone.
//
//  - The request fires 220ms AFTER the cursor stops. The endpoint allows 30
//    requests/min per client; a cursor sweeping across a ten-word line would
//    burn a third of that in a second. The delay makes "hovered" mean
//    "stopped", and the worker's cache makes every repeat sighting free.
//
//  - Listeners are delegated to `document`, never attached to word spans: the
//    on-video overlay rebuilds its children ~4×/sec (see SidebarUI's
//    updateOverlay), and per-span listeners would die with them.
//
//  - The card is positioned by its HEART, not its centre: the heart's x lands
//    on the hovered word, so saving is a straight ~10px move whatever width
//    the translations happen to have. The action row sits on the edge facing
//    the word, and an invisible bridge covers the 6px gap so the cursor never
//    leaves the card on its way to the button.
import { isEmbed, platformOf } from '../analytics';
import { msg } from '../i18n';
import { HEART_SVG, MORE_SVG, posLabel } from './icons';
import { loadLanguagePrefs } from '../languages';
import type { LookupResult } from './types';
import { MAX_LOOKUP_TERM_LEN } from './types';
import {
    hasLookupContent,
    posTags,
    showsLemma,
    stripDefinition,
    stripTranslations,
} from './shape';
import type { SelectionPayload } from '../content/quick-add-overlay';
import {
    buildContextForIndex,
    getSelectionPayload,
    saveTerm,
    selectionWordSpans,
    sendMessage,
} from '../content/quick-add-overlay';

const STRIP_ID = 'lingogram-lookup-strip';

// Word spans inside our own subtitle surfaces only. data-word excludes masked
// guess-mode words by construction — those carry data-hidden instead, and a
// word the user has not uncovered is not a lookup candidate either.
//
// Split by surface because the trigger differs: hover over the video (which
// also pauses), click in the sidebar transcript.
const OVERLAY_WORD_SELECTOR = '.vtt-overlay-main span[data-word]';
const SIDEBAR_WORD_SELECTOR = '.vtt-main-text span[data-word]';
const WORD_SELECTOR = `${OVERLAY_WORD_SELECTOR}, ${SIDEBAR_WORD_SELECTOR}`;

const HOVER_DELAY_MS = 220;   // the rate-limit debounce — see the header
const SPINNER_AFTER_MS = 400; // warm answers land in ~270ms; no flicker for them
const HIDE_DELAY_MS = 140;    // long enough to travel word → card
const ERROR_HIDE_MS = 2000;
const GAP_PX = 6;
const MARGIN_PX = 8;

export interface LookupStripOptions {
    /** Open the sidebar's word screen — wired by each app to its SidebarUI. */
    openDetail?: (term: string, context: string) => void;
    /**
     * Hold the page's layout still while a card is open; the returned function
     * releases the hold when it closes.
     *
     * The card is placed once, in viewport coordinates, so anything that moves
     * the caption under it tears the two apart. On YouTube that is the control
     * bar: the overlay is floored above it (controlsFloor.ts), the bar
     * autohides after a few seconds of stillness, and the captions then drop
     * ~41px in one step. Reading a translation IS that stillness, so it lands
     * mid-word — the gap opens, the cursor falls through it, and the card
     * closes on a word the user had not finished reading.
     *
     * Making the card chase the caption was the wrong fix: it keeps the two
     * together but jumps the text 41px under a resting cursor, which is worse
     * to read than it is to describe. Holding the layout means nothing moves
     * at all — not the caption, not the card, not the gap between them.
     *
     * Optional: a site with no such behaviour (the sidebar transcript, HDrezka)
     * simply does not pass one.
     */
    holdLayout?: () => () => void;
}

/**
 * What the card is pinned to. A hovered or clicked word is one span; a dragged
 * phrase is a range that no single element represents — it can even straddle
 * two cues. Both have to answer the same two questions, so the card holds an
 * Anchor rather than an element.
 *
 * `spans` are the word elements to tag "saved", which for a phrase is every
 * word it covers, and for a hover is the one under the cursor.
 */
interface Anchor {
    /** The word or phrase being looked up. */
    term: string;
    /**
     * The element a re-trigger is compared against, so hovering the same word
     * does not restart the lookup and clicking it again closes the card. Null
     * for a selection, which has no single element and is never re-triggered
     * by pointing at it.
     */
    key: HTMLElement | null;
    /** Where to put the card. Null once the anchor no longer exists on screen. */
    rect(): DOMRect | null;
    /** Whether the cursor is on the anchor, keeping an open card alive. */
    hovered(): boolean;
    spans(): HTMLElement[];
    /** The sentence around it, for the lookup's `context`. */
    context(): string;
    /** Overlay anchors pause the video; sidebar and selection ones do not. */
    pauses(): boolean;
}

function spanAnchor(span: HTMLElement): Anchor {
    return {
        term: span.dataset.word?.trim() ?? '',
        key: span,
        rect: () => {
            // The overlay rebuilds its children ~4x/sec, so the span a request
            // started on can be gone by the time the answer lands. Its rect is
            // then all zeros, which used to park the card in the top-left
            // corner — detached from any word, over the page chrome.
            if (!span.isConnected) return null;
            const r = span.getBoundingClientRect();
            return r.width === 0 && r.height === 0 ? null : r;
        },
        hovered: () => span.isConnected && span.matches(':hover'),
        spans: () => [span],
        context: () => {
            const scope = span.closest('.vtt-overlay-main, .vtt-item');
            const attr = scope?.getAttribute('data-index');
            const index = attr === null || attr === undefined ? NaN : parseInt(attr, 10);
            return Number.isFinite(index) ? buildContextForIndex(index) : '';
        },
        pauses: () => !!span.closest('.vtt-overlay-main'),
    };
}

/**
 * A dragged phrase. The rect is captured once, at mouseup: the range belongs to
 * a selection the user is about to lose — clicking the card's own heart
 * collapses it — so re-reading it later would return nothing. A caption line
 * scrolling away instead takes the card with it via the anchor watchdog.
 */
function selectionAnchor(payload: SelectionPayload, spans: HTMLElement[]): Anchor {
    const rect = payload.rect;
    // Cheapest proof the phrase is still on screen: the words it covered are
    // still in the document. An overlay rebuild detaches all of them at once.
    const alive = (): boolean => spans.length > 0 && spans.some((s) => s.isConnected);
    return {
        term: payload.term,
        key: null,
        rect: () => (alive() ? rect : null),
        // A selection is not a hover target — the card stays until dismissed.
        hovered: () => false,
        spans: () => spans,
        context: () => payload.context,
        pauses: () => spans.some((s) => s.closest('.vtt-overlay-main')),
    };
}

interface LookupResponse {
    ok: boolean;
    result?: LookupResult;
    error?: string;
}

/**
 * Returns a teardown, same contract as installQuickAddOverlay: the extensions
 * run it for the page's lifetime, the embed may remount.
 */
export function installLookupStrip(opts: LookupStripOptions = {}): () => void {
    // The embed has a faked chrome and no backend; the strip would only ever
    // show its error state there.
    if (isEmbed()) return () => {};

    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let spinTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    // Increments on every hide/re-target; a response carrying a stale token is
    // dropped rather than painted over the word the cursor has since left.
    let token = 0;
    let current: Anchor | null = null;
    let dragging = false;
    // Terms saved from this page, so a re-hover shows the filled heart. The
    // durable record lives in Firestore; this only has to survive the session.
    const savedTerms = new Set<string>();
    // The video we paused when the strip opened over it, so hiding can resume
    // exactly that element. Null whenever we did not pause: the sidebar path
    // never touches playback, and a video the user had already paused is left
    // paused when the strip goes away.
    let pausedVideo: HTMLVideoElement | null = null;
    // Undoes the layout hold taken while a card is open; null when none is held.
    let releaseLayout: (() => void) | null = null;

    /**
     * Pause the video under an overlay lookup.
     *
     * Reading a translation takes a second or two, and the caption line the
     * word belongs to is gone by then — so the strip that answers "what does
     * this mean" also has to stop the thing that is taking the question away.
     * Only for the overlay: the sidebar transcript stands still on its own.
     *
     * A video that was ALREADY paused is not recorded, so resume() leaves it
     * as the user left it.
     */
    function pauseForLookup(): void {
        if (pausedVideo) return;
        const video = document.querySelector('video');
        if (!video || video.paused) return;
        video.pause();
        pausedVideo = video;
    }

    /** Resume only what we paused, and only if nobody has moved on since. */
    function resumeAfterLookup(): void {
        const video = pausedVideo;
        pausedVideo = null;
        // isConnected guards an SPA navigation swapping the element out; the
        // paused check leaves a video the user restarted by hand alone.
        if (video?.isConnected && video.paused) void video.play().catch(() => {});
    }

    const strip = (): HTMLElement | null => document.getElementById(STRIP_ID);

    // The word(s) the open card belongs to, underlined for as long as it is
    // up — the card floats at a distance, and the mark is what ties the two
    // together (the approved mock had it; the first build lost it).
    let markedSpans: HTMLElement[] = [];
    function markAnchor(anchor: Anchor | null): void {
        for (const el of markedSpans) el.classList.remove('vtt-lookup-hit');
        markedSpans = anchor ? anchor.spans().filter((el) => el.isConnected) : [];
        for (const el of markedSpans) el.classList.add('vtt-lookup-hit');
    }

    function removeStrip(): void {
        clearTimeout(spinTimer);
        clearTimeout(errorTimer);
        token++;
        current = null;
        markAnchor(null);
        releaseLayout?.();
        releaseLayout = null;
        strip()?.remove();
        resumeAfterLookup();
    }

    function ensureStrip(): HTMLElement {
        let el = strip();
        const parent = document.fullscreenElement ?? document.body;
        if (el && el.parentElement !== parent) {
            el.remove();
            el = null;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = STRIP_ID;
            el.addEventListener('mouseleave', () => scheduleHide());
            el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            parent.appendChild(el);
        }
        return el;
    }

    /**
     * Place the card so the heart's centre sits on the word's centre — or,
     * with no heart rendered yet (the loading state), fall back to centring
     * the card itself. Clamped to the viewport on both axes; the side flips
     * below the word when there is no room above, and the CSS `above`/`below`
     * classes move the action row onto the edge facing the word.
     */
    function place(el: HTMLElement, anchor: Anchor): void {
        const rect = anchor.rect();
        if (!rect) {
            removeStrip();
            return;
        }

        el.style.visibility = 'hidden';
        el.classList.add('on');

        // Measure with a side class already applied. `.below` flips the flex
        // direction so the action row sits on the other edge, and a card
        // measured without one could report a different height than the one
        // finally painted — placing it a row's worth off the word.
        el.classList.add('above');
        el.classList.remove('below');
        let height = el.offsetHeight;
        const fitsAbove = rect.top - GAP_PX - height >= MARGIN_PX;
        if (!fitsAbove) {
            el.classList.remove('above');
            el.classList.add('below');
            height = el.offsetHeight;
        }

        // Anchor on the heart so the button lands under the cursor whatever
        // the translations' width. offsetLeft is relative to the card only
        // while the card is its offsetParent — it is position:fixed, so it is.
        const heart = el.querySelector<HTMLElement>('.vtt-lookup-heart');
        const width = el.offsetWidth;
        const anchorOffset = heart
            ? heart.offsetLeft + heart.offsetWidth / 2
            : width / 2;
        const left = Math.min(
            Math.max(MARGIN_PX, Math.round(rect.left + rect.width / 2 - anchorOffset)),
            Math.max(MARGIN_PX, window.innerWidth - width - MARGIN_PX),
        );
        const top = fitsAbove
            ? Math.round(rect.top - GAP_PX - height)
            : Math.round(rect.bottom + GAP_PX);
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = '';
    }

    function renderLoading(anchor: Anchor): void {
        const el = ensureStrip();
        el.innerHTML =
            `<div class="vtt-lookup-body vtt-lookup-pending">` +
            `<span class="vtt-lookup-spin" aria-hidden="true"></span>` +
            `<span>${escapeHtml(msg('ytLookupLoading', 'Looking up…'))}</span></div>`;
        place(el, anchor);
    }

    function renderError(anchor: Anchor): void {
        const el = ensureStrip();
        el.innerHTML =
            `<div class="vtt-lookup-body vtt-lookup-error" role="alert">` +
            `${escapeHtml(msg('ytLookupError', "Couldn't load"))}</div>`;
        place(el, anchor);
        // The strip must not squat over the video announcing a failure; it
        // fades and the next hover simply tries again.
        clearTimeout(errorTimer);
        errorTimer = setTimeout(() => removeStrip(), ERROR_HIDE_MS);
    }

    function renderResult(anchor: Anchor, word: string, context: string, r: LookupResult): void {
        const el = ensureStrip();
        const empty = !hasLookupContent(r);
        const saved = savedTerms.has(word.toLowerCase());

        let body = '<div class="vtt-lookup-body">';
        if (empty) {
            body += `<span class="vtt-lookup-muted">${escapeHtml(msg('ytLookupNone', 'No translation'))}</span>`;
        } else {
            const tags = posTags(r);
            if (tags.length) {
                // ONE tag, unhighlighted. The dictionary orders by dominant
                // reading, not by the sentence — the provider never sees it —
                // so highlighting a "lead" tag claimed a context match that
                // was not there, and three tags read as labels on the
                // translations below. The dominant tag alone is an honest
                // gist; the full list lives on the word screen.
                body += `<span class="vtt-lookup-pos"><span class="vtt-lookup-pos-tag">${
                    escapeHtml(posLabel(tags[0]))}</span></span>`;
            }
            const translations = stripTranslations(r);
            if (translations.length) {
                // Real spaces around the dots, not just margins: margins
                // create visual gaps but no break opportunities, so three long
                // translations used to render as ONE unbreakable line that
                // ignored the card's max-width and ran through its border.
                body += `<span class="vtt-lookup-tr">${
                    translations.map(escapeHtml).join(' <span class="vtt-lookup-sep">·</span> ')
                }</span>`;
            } else {
                // The dictionary defines the word but carries no equivalents
                // in this language (an honest empty list, never a guess) —
                // the definition is the next best line.
                body += `<span class="vtt-lookup-def">${escapeHtml(stripDefinition(r))}</span>`;
            }
            // The base form earns its pixels only when it differs AND the
            // entry corroborates it — see showsLemma for the -er/-est trap.
            if (showsLemma(r)) {
                body += `<span class="vtt-lookup-lemma">${escapeHtml(r.lemma)}</span>`;
            }
        }
        body += '</div>';

        const saveLabel = saved ? msg('ytLookupSaved', 'Saved') : msg('ytLookupSave', 'Save');
        let acts = '<div class="vtt-lookup-acts">' +
            `<button type="button" class="vtt-lookup-btn vtt-lookup-heart${saved ? ' saved' : ''}" data-act="save">` +
            `${HEART_SVG}<span>${escapeHtml(saveLabel)}</span></button>`;
        // Nothing to expand on an empty answer, so "More" is not offered.
        if (!empty && opts.openDetail) {
            // The icon balances the heart's: without one, "More" read as the
            // lesser button, though it opens the richer half of the feature.
            acts += `<button type="button" class="vtt-lookup-btn" data-act="more">${
                MORE_SVG}<span>${escapeHtml(msg('ytLookupMore', 'Details'))}</span></button>`;
        }
        acts += '</div>';

        el.innerHTML = body + acts;
        el.dataset.word = word;

        el.onclick = (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
            if (!btn) return;
            e.stopPropagation();
            if (btn.dataset.act === 'save') {
                void handleSave(btn, word, context, anchor);
            } else {
                opts.openDetail?.(word, context);
                removeStrip();
            }
        };
        place(el, anchor);
    }

    async function handleSave(btn: HTMLElement, word: string, context: string, anchor: Anchor): Promise<void> {
        const term = word.toLowerCase();
        // Saving again is not un-saving: removal lives in the site's word
        // list, and a second tap on a heart must never silently delete.
        if (savedTerms.has(term)) return;
        (btn as HTMLButtonElement).disabled = true;
        const ok = await saveTerm(term, context, anchor.spans());
        (btn as HTMLButtonElement).disabled = false;
        if (!ok) return;
        savedTerms.add(term);
        btn.classList.add('saved');
        const label = btn.querySelector('span');
        if (label) label.textContent = msg('ytLookupSaved', 'Saved');
    }

    async function show(anchor: Anchor): Promise<void> {
        const word = anchor.term;
        if (!word) return;
        const prefs = await loadLanguagePrefs();
        // No native language chosen yet means no language to translate into —
        // the same gate that keeps subtitles from rendering pre-onboarding.
        if (!prefs?.native) return;

        current = anchor;
        markAnchor(anchor);
        // Freeze the page's layout for as long as the card is up — see
        // LookupStripOptions.holdLayout.
        if (!releaseLayout) releaseLayout = opts.holdLayout?.() ?? null;
        const my = ++token;
        const context = anchor.context();
        // Over the video only — see pauseForLookup. Done before the request so
        // the line stops moving immediately rather than after the round-trip.
        if (anchor.pauses()) pauseForLookup();

        clearTimeout(spinTimer);
        spinTimer = setTimeout(() => {
            if (my === token) renderLoading(anchor);
        }, SPINNER_AFTER_MS);

        try {
            const res = await sendMessage<LookupResponse>({
                action: 'LOOKUP_WORD',
                term: word,
                context,
                targetLang: prefs.native,
                site: platformOf(location.hostname),
            });
            if (my !== token) return;
            clearTimeout(spinTimer);
            if (res?.ok && res.result) {
                renderResult(anchor, word, context, res.result);
            } else if (res?.error === 'lookup not configured') {
                // A build without an API is not broken — the strip simply
                // does not exist there.
                removeStrip();
            } else {
                renderError(anchor);
            }
        } catch {
            if (my !== token) return;
            clearTimeout(spinTimer);
            renderError(anchor);
        }
    }

    function scheduleHide(): void {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            const el = strip();
            if (el?.matches(':hover')) return;
            if (current?.hovered()) return;
            removeStrip();
        }, HIDE_DELAY_MS);
    }

    /**
     * Keep an open card on its word, or drop it when the word is gone.
     *
     * Two different things move the caption out from under a card that is
     * sitting still:
     *
     *  - The cue changes and the overlay rebuilds, detaching the span. The
     *    card would float where the old line used to be, with the video
     *    paused for a word no longer on screen — so it goes away.
     *
     *  - The caption block MOVES while the same word stays on screen. YouTube
     *    autohides its control bar after a few seconds of stillness, and the
     *    overlay is floored above that bar (apps/youtube controlsFloor.ts):
     *    when the bar goes, the floor drops to 0 and the captions fall ~41px
     *    in one step. Reading a translation is exactly the kind of stillness
     *    that triggers the autohide, so this fires while the user is mid-word.
     *    The card is placed once, in absolute viewport coordinates, so it
     *    stayed put and tore away from its word — and the widening gap
     *    dropped the cursor out of it, closing the card mid-read.
     */
    /**
     * The overlay rebuilds on every cue change, which silently detaches the
     * span the open card is anchored to. Without this the card keeps floating
     * where the old line used to be — and the video stays paused for a word
     * that is no longer on screen.
     */
    function dropIfAnchorGone(): void {
        if (!strip()) return;
        if (current && !current.rect()) removeStrip();
    }

    const anchorWatch = setInterval(dropIfAnchorGone, 500);

    const onMouseOver = (e: MouseEvent): void => {
        // Mid-drag the cursor sweeps the words being selected; opening a card
        // for each would fight the phrase the user is still drawing. The
        // finished selection opens one card on mouseup.
        if (dragging) return;
        // Overlay only. In the sidebar the cursor crosses dozens of words on
        // the way anywhere, and each one would open a strip nobody asked for;
        // that surface opens on click instead (see onClick).
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(OVERLAY_WORD_SELECTOR);
        if (!span) return;
        clearTimeout(hideTimer);
        if (span === current?.key) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => void show(spanAnchor(span)), HOVER_DELAY_MS);
    };

    const onMouseOut = (e: MouseEvent): void => {
        // Matches onMouseOver: only the overlay opens on hover, so only the
        // overlay closes on leaving. A sidebar strip stays until it is
        // dismissed by a click elsewhere or another word.
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(OVERLAY_WORD_SELECTOR);
        if (!span) return;
        const to = e.relatedTarget as Node | null;
        if (to && (span.contains(to) || strip()?.contains(to))) return;
        clearTimeout(hoverTimer);
        scheduleHide();
    };

    /**
     * The sidebar's trigger. Click, not hover: the transcript is a list the
     * cursor travels across, and hovering it would fire a lookup per word.
     *
     * Runs in the CAPTURE phase and stops the event, because the cue's own
     * click handler seeks the video (SidebarUI.buildPlainItem) — a word click
     * means "what is this", not "replay from here". Clicking anywhere else in
     * the cue still seeks, since only a [data-word] span is intercepted.
     */
    const onClick = (e: MouseEvent): void => {
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(SIDEBAR_WORD_SELECTOR);
        if (!span) return;
        // A click that ends a drag is a selection, and it carries the whole
        // phrase — onSelectionMouseUp owns that, with the wider term.
        if (!window.getSelection()?.isCollapsed) return;
        e.stopPropagation();
        e.preventDefault();
        clearTimeout(hoverTimer);
        if (span === current?.key && strip()) {
            // Second click on the open word closes it.
            removeStrip();
            return;
        }
        removeStrip();
        void show(spanAnchor(span));
    };

    /**
     * A dragged phrase opens the same card a hovered word does. This replaces
     * the old "+ Lingogram" pill, which was a second, differently-shaped offer
     * over the same subtitles — and which could only save, never translate.
     *
     * Runs after the pointer is released: mid-drag the range grows with every
     * mousemove, and looking up each intermediate phrase would be one request
     * per pixel.
     */
    const onSelectionMouseUp = (): void => {
        // Defer so the selection is final — a click that lands on the open
        // card (its own heart) collapses the range, and reading it in the same
        // tick would catch the pre-collapse state.
        setTimeout(() => {
            const payload = getSelectionPayload();
            if (!payload || payload.term.length > MAX_LOOKUP_TERM_LEN) return;
            // One word dragged over is the word itself — let the span path own
            // it, so hovering it again finds the card already open on it.
            const spans = selectionWordSpans();
            removeStrip();
            void show(spans.length === 1
                ? spanAnchor(spans[0])
                : selectionAnchor(payload, spans));
        }, 0);
    };

    const onMouseDown = (e: MouseEvent): void => {
        dragging = true;
        const el = strip();
        if (!el || el.contains(e.target as Node)) return;
        // A press on a sidebar word is the open/close toggle, and mousedown
        // runs BEFORE click — tearing the strip down here would make every
        // second click re-open the word instead of closing it. onClick owns
        // that case; this only dismisses presses landing somewhere else.
        if ((e.target as Element | null)?.closest?.(SIDEBAR_WORD_SELECTOR)) return;
        removeStrip();
    };
    const onMouseUp = (): void => {
        dragging = false;
        onSelectionMouseUp();
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    // Capture, so the word is intercepted before the cue's seek handler.
    document.addEventListener('click', onClick, true);

    return () => {
        document.removeEventListener('mouseover', onMouseOver);
        document.removeEventListener('mouseout', onMouseOut);
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('click', onClick, true);
        clearInterval(anchorWatch);
        releaseLayout?.();
        releaseLayout = null;
        clearTimeout(hoverTimer);
        clearTimeout(hideTimer);
        removeStrip();
    };
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
        c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
}
