// The feedback form's DOM, built into a panel the sidebar owns.
//
// Only the BUILDER moves. openFeedbackScreen/closeFeedbackScreen stay on
// SidebarUI, because what they encode is the ordering between the three
// takeover screens — feedback lies on top of settings and returns into it, and
// closeFeedbackScreen's restoreFocus argument exists precisely because the
// settings toggle closing feedback must NOT move focus onto an element it is
// about to hide. That knowledge belongs in one place, next to the other two
// screens, not split across two files.
import { msg } from '../i18n';
import {
    MAX_FEEDBACK_BYTES,
    clampToBytes,
    composeFeedbackText,
    feedbackCopy,
    sendFeedback,
    utf8Len,
} from '../feedback';

/**
 * What the feedback form needs from the sidebar hosting it.
 *
 * An object of closures, not an interface SidebarUI implements: isSignedIn is
 * private there, and `implements` would force it public — widening exactly the
 * surface this split exists to narrow. Same reasoning as WordScreenHost.
 */
export interface FeedbackScreenHost {
    /**
     * Hand the message box back to the host.
     *
     * A registration rather than a return value because the host reassigns its
     * element map wholesale and empties it on teardown; the host must own the
     * reference, or open() would focus a node that is no longer the live one.
     */
    registerTextarea(el: HTMLTextAreaElement): void;
    /** The form's own exit path. The host owns takeover ordering. */
    close(): void;
    /** Private on the host: decides whether the form asks for a reply address. */
    isSignedIn(): Promise<boolean>;
}

// Populated per-open. Signed-in users are identified by the uid the
// background stamps from their own token, so the form only asks for an
// email when there is no account to tie the message back to.
export function buildFeedbackScreen(panel: HTMLDivElement, host: FeedbackScreenHost): void {
    const intro = document.createElement('p');
    intro.className = 'vtt-feedback-intro';
    intro.textContent = msg(
        'ytFeedbackIntro',
        'Tell us what broke or what you would change. We read every message.',
    );

    const textarea = document.createElement('textarea');
    textarea.id = 'vtt-feedback-text';
    textarea.className = 'vtt-feedback-text';
    textarea.rows = 6;
    textarea.placeholder = feedbackCopy.hint();
    textarea.setAttribute('aria-label', feedbackCopy.hint());

    // Only appears near the byte ceiling — an always-on counter reads as a
    // limit to hit rather than one to ignore.
    const counter = document.createElement('div');
    counter.className = 'vtt-feedback-counter';
    counter.hidden = true;
    counter.setAttribute('aria-live', 'polite');

    const status = document.createElement('div');
    status.className = 'vtt-feedback-status';
    status.hidden = true;

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'vtt-feedback-send';
    send.textContent = feedbackCopy.send();
    send.disabled = true;

    // Optional reply address, signed-out users only. Rendered async because
    // the auth check is a round trip to the background; the textarea is
    // usable the whole time, so nothing blocks on it.
    const emailRow = document.createElement('div');
    emailRow.className = 'vtt-feedback-email-row';
    emailRow.hidden = true;
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'vtt-feedback-email';
    emailInput.className = 'vtt-feedback-email';
    emailInput.placeholder = msg('ytFeedbackEmailHint', 'Email (optional, if you want a reply)');
    emailInput.setAttribute('aria-label', msg('ytFeedbackEmailHint', 'Email (optional, if you want a reply)'));
    const emailLabel = document.createElement('label');
    emailLabel.className = 'vtt-feedback-email-label';
    emailLabel.htmlFor = emailInput.id;
    emailLabel.textContent = msg('ytFeedbackEmailLabel', 'Reply address');
    emailRow.append(emailLabel, emailInput);

    void host.isSignedIn().then((signedIn) => {
        // Guard against a close-then-reopen racing this resolve: only touch
        // the row if it is still the one in the live panel.
        if (!signedIn && emailRow.isConnected) emailRow.hidden = false;
    });

    const budget = () => MAX_FEEDBACK_BYTES - utf8Len(composeFeedbackText(textarea.value, emailInput.value));

    // Clamp the field being typed in, never the other one. The email rides
    // inside the same byte budget, so typing an address can push the total
    // over — but taking the overflow out of the MESSAGE would delete text
    // the user wrote earlier, from a field they aren't even looking at.
    // Whoever is typing is the one who gets stopped.
    const clampField = (field: HTMLTextAreaElement | HTMLInputElement) => {
        const over = -budget();
        if (over <= 0) return;
        // selectionStart/setSelectionRange throw on input[type=email] —
        // the selection API is only defined for text-like inputs — so the
        // caret is restored on a best-effort basis.
        let caret: number | null = null;
        try {
            caret = field.selectionStart;
        } catch {
            caret = null;
        }
        const clamped = clampToBytes(field.value, Math.max(0, utf8Len(field.value) - over));
        const dropped = field.value.length - clamped.length;
        if (!dropped) return;
        field.value = clamped;
        if (caret === null) return;
        const next = Math.max(0, caret - dropped);
        try {
            field.setSelectionRange(next, next);
        } catch {
            // Field doesn't support a caret; the clamp still applied.
        }
    };

    const syncLimits = (typed?: HTMLTextAreaElement | HTMLInputElement) => {
        // Hard-clamp on the real budget: typing past the cap stops adding
        // characters instead of letting the send path silently truncate.
        if (typed) clampField(typed);
        const left = budget();
        counter.hidden = left > 200;
        // A bare number announces as "0" and says nothing about what ran
        // out; the visible text carries its unit, and the label spells it
        // out for a screen reader.
        counter.textContent = feedbackCopy.charsLeft(left);
        counter.setAttribute('aria-label', feedbackCopy.charsLeft(left));
        send.disabled = textarea.value.trim().length === 0;
    };
    textarea.addEventListener('input', () => syncLimits(textarea));
    emailInput.addEventListener('input', () => syncLimits(emailInput));

    send.addEventListener('click', async () => {
        const text = textarea.value.trim();
        if (!text) return;
        send.disabled = true;
        send.textContent = feedbackCopy.sending();
        status.hidden = true;
        const ok = await sendFeedback(text, emailRow.hidden ? '' : emailInput.value);
        if (ok) {
            // The panel stays open (unlike the rating card, which removes
            // itself), so the success state has to be a real screen: the
            // form is replaced by a thank-you and the only move is back.
            const done = document.createElement('div');
            done.className = 'vtt-feedback-done';
            done.setAttribute('role', 'status');
            done.textContent = feedbackCopy.sent();
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'vtt-feedback-send';
            back.textContent = msg('ytFeedbackBackToSettings', 'Back to settings');
            back.addEventListener('click', () => host.close());
            panel.replaceChildren(done, back);
            back.focus();
            return;
        }
        // Don't make the user retype: keep the text, let them try again.
        send.disabled = false;
        send.textContent = feedbackCopy.send();
        status.hidden = false;
        status.textContent = feedbackCopy.failed();
        status.setAttribute('role', 'alert');
    });

    const actions = document.createElement('div');
    actions.className = 'vtt-feedback-actions';
    actions.append(counter, send);

    panel.replaceChildren(intro, textarea, emailRow, status, actions);
    host.registerTextarea(textarea);
    // NOT focused here: the panel is still hidden at this point, and
    // focusing a display:none element is a no-op that leaves focus on the
    // body. openFeedbackScreen focuses it once the screen is shown.
}
