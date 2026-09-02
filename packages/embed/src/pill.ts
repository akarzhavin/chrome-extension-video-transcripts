// The "+ Lingogram" save pill.
//
// It used to live in the extensions, where selecting a phrase popped it as the
// only way to save one. The lookup card took that trigger over — it answers
// what the phrase MEANS and saves it from the same card — and two offers over
// the same subtitles was one too many.
//
// The embed keeps it because the card cannot work here: this surface runs on a
// chrome shim with no service worker to route LOOKUP_WORD through, and
// installLookupStrip opts out of embeds entirely. Without the pill the demo on
// the marketing site would have no way to save a word at all, and the site
// counts those saves (demo_word_saved).
import {
    MAX_TERM_LEN,
    getSelectionPayload,
    msg as i18nMsg,
    saveTerm,
    selectionWordSpans,
} from '@video-transcripts/shared';

const PILL_ID = 'lingogram-quick-add-pill';

// Half the pill's own width, used to centre it over the selection before
// clamping. The pill is sized by its content, so this is an estimate that only
// has to be close — the clamp below is what guarantees it stays on screen.
const PILL_HALF_WIDTH = 50;
const PILL_MARGIN = 8;

function removePill(): void {
    document.getElementById(PILL_ID)?.remove();
}

function showPill(rect: DOMRect, term: string, context: string): void {
    removePill();
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.textContent = i18nMsg('ytQuickAddPill', '+ Lingogram');

    // Clamp to the viewport on both axes. Selecting the first word of a line
    // near the left edge used to push the pill off-screen (centre - 50 goes
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
        pill.textContent = '\u2026';
        const ok = await saveTerm(term, context, savedSpans);
        if (ok) {
            // Drop the range so the overlay's selection-guard releases and
            // resumes timeupdate rebuilds.
            window.getSelection()?.removeAllRanges();
        }
        removePill();
    });

    (document.fullscreenElement ?? document.body).appendChild(pill);
}

/** Returns a teardown; a remount must not stack a second set of handlers. */
export function installQuickAddPill(): () => void {
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
        if (pill && !pill.contains(e.target as Node)) removePill();
    };
    document.addEventListener('mousedown', onMouseDown);

    return () => {
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mousedown', onMouseDown);
        removePill();
    };
}
