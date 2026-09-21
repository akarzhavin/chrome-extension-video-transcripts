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
import { createSavedWords } from './saved-words';
import { loadMirror, onMirrorChanged } from '../word-mirror';
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
    removeTerm,
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

// What the cursor may open a card on over the video: revealed words, and also
// the masked capsules of guess mode, which park their word in data-hidden.
//
// A capsule is a legitimate lookup target even though it is not a SAVEABLE
// one — the card answers "what is this word", which is a different question
// from "add it to my list", and quick-add's span[data-word] queries still skip
// it. Over the video only: the sidebar is a transcript the cursor crosses on
// the way anywhere, and it has no peek for the same reason.
const OVERLAY_HOVER_SELECTOR = '.vtt-overlay-main span[data-word], .vtt-overlay-main span[data-hidden]';

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

/**
 * Is the pointer still physically on this element?
 *
 * Asked when a mouseout arrives with no relatedTarget, which is ambiguous: the
 * cursor may have left the window, or the node it was standing on may have been
 * destroyed under it. Only the first is a departure.
 *
 * Geometry rather than `:hover` because this runs in the frame where the DOM
 * just changed, and `:hover` is recomputed style — it may not have been
 * recalculated yet, which would make the answer depend on timing. The rect is
 * arithmetic on coordinates the event already carries. `:hover` remains the
 * fallback for a box that cannot be measured (a detached or zero-sized node).
 */
function stillOnSpan(span: HTMLElement, e: MouseEvent): boolean {
    const r = span.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return span.matches(':hover');
    return e.clientX >= r.left && e.clientX <= r.right
        && e.clientY >= r.top && e.clientY <= r.bottom;
}

function spanAnchor(span: HTMLElement): Anchor {
    return {
        // A masked guess-mode capsule keeps its word in data-hidden instead —
        // see makeMaskedSpan. Reading both is what lets the card open over a
        // word the user has not uncovered yet.
        term: (span.dataset.word ?? span.dataset.hidden)?.trim() ?? '',
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
    // The last point the pointer was physically reported at, and the guard that
    // tells a hover the user performed from one the subtitles performed on them.
    //
    // The overlay rebuilds its children ~4x/sec, and a rebuild can put a fresh
    // word under a cursor that has not moved in minutes. Chrome reports that as
    // an ordinary mouseover on the new word — measured in Chrome, it arrives as
    // a bare mouseout/mouseover pair with no mousemove before OR after it, and
    // carrying the coordinates the pointer already had. Acted on, it opens a
    // card and pauses the film under someone who was only watching.
    //
    // So the question "did the user hover this" is answered by the coordinates:
    // a hover the user performed lands somewhere the pointer was not already
    // sitting. Null until the first mousemove, because with no point on record
    // there is nothing to be suspicious of — the first hover of a page is taken
    // at face value.
    let restingAt: { x: number; y: number } | null = null;
    // The word whose card the user just closed, held until the pointer leaves
    // it. Only the mousemove path consults it: that path aims at the word under
    // a moving cursor, which is also where the cursor is left standing after a
    // click that dismissed the card, so without this the dismissal is undone by
    // the smallest tremor of the hand that performed it.
    let dismissed: HTMLElement | null = null;
    // Which words read as saved in this tab. Shared with the word screen
    // through one object rather than a Set each, which is what makes the
    // strip's heart and the screen's controls agree about the same word.
    const savedWords = createSavedWords();
    // Seeded from the mirror and kept in step with it, so a word saved on a
    // previous page — or in another tab, right now — shows its filled heart
    // the first time the cursor rests on it. `seeded` is awaited before the
    // card paints; without that wait a hover in the first moments after install
    // would render an empty heart and never repaint.
    const seeded = loadMirror().then((m) => {
        savedWords.reset(m.words);
    });
    const unsubscribeMirror = onMirrorChanged((m) => savedWords.reset(m.words));
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
        const saved = savedWords.has(word);

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

        const saveLabel = saved ? msg('ytLookupRemove', 'Remove') : msg('ytLookupSave', 'Save');
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
        // A TOGGLE since US2. The guard that used to stand here — "saving again
        // is not un-saving" — held while removal lived only in the site's word
        // list; the second tap now takes the word off it.
        //
        // Dispatch on the word's current state rather than on whether it has
        // ever been saved: a word the mirror calls `removed` reads as unsaved
        // and is saved again as an ordinary save.
        const wasSaved = savedWords.has(term);
        (btn as HTMLButtonElement).disabled = true;
        const ok = wasSaved
            ? await removeTerm(term, anchor.spans())
            : await saveTerm(term, context, anchor.spans());
        (btn as HTMLButtonElement).disabled = false;
        if (!ok) return;
        if (wasSaved) savedWords.delete(term);
        else savedWords.add(term);
        btn.classList.toggle('saved', !wasSaved);
        const label = btn.querySelector('span');
        // The label says what pressing it does next, so a saved word offers
        // "Remove" rather than stating "Saved".
        if (label) {
            label.textContent = wasSaved
                ? msg('ytLookupSave', 'Save')
                : msg('ytLookupRemove', 'Remove');
        }
    }

    async function show(anchor: Anchor): Promise<void> {
        const word = anchor.term;
        if (!word) return;
        const prefs = await loadLanguagePrefs();
        // Alongside the prefs read, not after it: both are storage reads that
        // the card cannot paint correctly without.
        await seeded;
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
        // `dragging` is set on mousedown and cleared on mouseup — but that
        // mouseup can go missing. Pressing a guess capsule REVEALS it, the
        // reveal repaints the overlay, and the repaint detaches the very node
        // the press landed on; an event dispatched at a detached node
        // propagates nowhere, so neither document nor window ever hears the
        // release. The flag then stayed true for the life of the page and this
        // early return switched the card off after the first reveal.
        //
        // The event itself carries the truth: `buttons` is a live bitmask of
        // what is held down right now, so a stale flag is corrected the moment
        // the cursor moves with nothing pressed. A genuine drag still reports a
        // non-zero mask and still suppresses the card.
        if (dragging && e.buttons === 0) dragging = false;
        if (dragging) return;
        // Overlay only. In the sidebar the cursor crosses dozens of words on
        // the way anywhere, and each one would open a strip nobody asked for;
        // that surface opens on click instead (see onClick).
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(OVERLAY_HOVER_SELECTOR);
        if (!span) return;
        // The word came to the cursor rather than the cursor to the word: the
        // pointer is exactly where it was last seen, so this hover is the
        // overlay's repaint, not a question anybody asked.
        if (restingAt && e.clientX === restingAt.x && e.clientY === restingAt.y) return;
        aimAt(span);
    };

    /** Arm the debounce for a word the user has genuinely pointed at. */
    const aimAt = (span: HTMLElement): void => {
        clearTimeout(hideTimer);
        if (span === current?.key) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => void show(spanAnchor(span)), HOVER_DELAY_MS);
    };

    const onMouseOut = (e: MouseEvent): void => {
        // Matches onMouseOver: only the overlay opens on hover, so only the
        // overlay closes on leaving. A sidebar strip stays until it is
        // dismissed by a click elsewhere or another word.
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(OVERLAY_HOVER_SELECTOR);
        if (!span) return;
        const to = e.relatedTarget as Node | null;
        if (to && (span.contains(to) || strip()?.contains(to))) return;
        // A null relatedTarget means two different things, and only one of them
        // is a departure. The cursor may have left the window — or the node it
        // was standing on may have been DESTROYED under it, which Chrome also
        // reports as a mouseout with nothing to point at.
        //
        // Over a guess capsule the second happens constantly: the peek moves
        // the word into a .vtt-peek-face child on the hover itself, then
        // rewrites that child again at the flip's halfway point (180ms) — both
        // inside this card's 220ms debounce. Taken as a departure, each one
        // cancelled the pending lookup, so the pill came up only when the
        // timing happened to miss both.
        //
        // Answered from the pointer's COORDINATES, which the event carries,
        // rather than from :hover. Both describe the same thing, but :hover is
        // recomputed style — in the very frame the node under the cursor was
        // destroyed there is no guarantee it has been recalculated yet, so it
        // decides this by timing. The rect is just arithmetic on numbers the
        // event already holds. (:hover stays as the fallback for the case the
        // rect cannot be measured at all.)
        if (!to && span.isConnected && stillOnSpan(span, e)) return;
        // Past every "not really a departure" guard above, so the pointer has
        // genuinely left this word: a dismissal recorded against it has served
        // its purpose and must not outlive it, or the word would be unhoverable
        // for as long as it stays on screen.
        if (span === dismissed) dismissed = null;
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

    /**
     * Records where the pointer physically is — the reference the hover guard
     * measures against — and doubles as the second way a word gets aimed at.
     *
     * Runs on every mousemove of a cursor crossing the player, so it stays two
     * comparisons and a selector match; the request it may arm is still behind
     * the same 220ms debounce as any other hover.
     */
    const onMouseMove = (e: MouseEvent): void => {
        const moved = !restingAt || e.clientX !== restingAt.x || e.clientY !== restingAt.y;
        restingAt = { x: e.clientX, y: e.clientY };
        if (!moved) return;
        // Everything onMouseOver refuses to open a card for, this path must
        // refuse too — it is the same offer reached by a different gesture.
        // Mid-drag the cursor sweeps the words being selected, and here it does
        // so continuously: without this, drawing a two-word phrase spends a
        // request per word on the way and pauses the film mid-selection, and
        // then onSelectionMouseUp spends a third on the phrase itself.
        if (dragging && e.buttons === 0) dragging = false;
        if (dragging) return;
        // A word suppressed above must not stay dead until the cue changes
        // again. Moving the pointer WITHIN the word it already rests on fires
        // no mouseover at all — the hit target never changes — so that gesture
        // reaches us only here, and it is the one that says "yes, this word, I
        // mean it". Measured in Chrome: park on a word, let the cue rebuild
        // (suppressed), then nudge 3px; without this the card never opens.
        const span = (e.target as Element | null)?.closest?.<HTMLElement>(OVERLAY_HOVER_SELECTOR);
        if (!span) return;
        // A card the user just dismissed stays dismissed while the pointer is
        // still standing in the word it belonged to. Clicking a word closes its
        // card, and the hand that clicks is never perfectly still — a 1px
        // tremor would land here, find `current` already cleared, and re-open
        // the card the click had just closed. The mouseover path cannot reach
        // this state at all, because moving within a span fires no mouseover;
        // the dismissal is only forgotten when the pointer leaves the word.
        if (span === dismissed) return;
        aimAt(span);
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
        // Remember the overlay word the press landed in, if any, so the nudge
        // that follows the click does not re-open what the click dismissed.
        dismissed = (e.target as Element | null)
            ?.closest?.<HTMLElement>(OVERLAY_HOVER_SELECTOR) ?? null;
        removeStrip();
    };
    const onMouseUp = (): void => {
        dragging = false;
        onSelectionMouseUp();
    };


    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    // Capture, so the word is intercepted before the cue's seek handler.
    document.addEventListener('click', onClick, true);

    return () => {
        unsubscribeMirror();
        document.removeEventListener('mouseover', onMouseOver);
        document.removeEventListener('mousemove', onMouseMove);
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
