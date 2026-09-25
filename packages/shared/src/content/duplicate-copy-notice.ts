// The "Lingogram is running twice" banner.
//
// Two installed copies of the same edition — typically the Chrome Web Store
// build next to an unpacked one — both inject into the page. They share every
// element id, so only one of them builds the panel (SidebarUI.init yields to a
// sidebar stamped by another extension id). That keeps the panel whole, but the
// rest of both copies keeps running: the lookup card is one shared element with
// a click handler from EACH copy, because Chrome keeps `onclick` per isolated
// world. One press of "Save" therefore sends two saves, one per copy. The second
// either lands on a copy that is not signed in ("sign in to save", though the
// learner is signed in) or, when both are, is refused by the rules' one-second
// floor (`Firestore rules 403`). Measured live 2026-09-25: every single press
// produced two ADD_WORD messages within the same millisecond.
//
// Nothing about either symptom points at the cause, so the copy that yielded —
// the only one that KNOWS there is another — says so.
//
// Only the yielding copy can tell. The owner sees nothing of its rival: a copy
// that yields writes nothing to the page. So the banner is rendered into the
// OTHER copy's panel, deliberately — the one exception to the no-grafting rule,
// and the reason every piece of it is self-contained: its styles come from this
// copy's own manifest stylesheet, its button talks to this copy's own worker.

import { msg as t } from '../i18n';
import { sendMessage } from '../messaging';

const NOTICE_ID = 'vtt-duplicate-notice';

/**
 * How often to re-check. The owner may still be building its panel when this
 * copy yields (no #vtt-subheader to mount under yet), and it may rebuild the
 * panel later and drop the banner with it. Two property reads per tick.
 */
const POLL_MS = 2000;

/** A Chrome extension id: 32 letters a–p. Anything else is not put in a URL. */
const EXTENSION_ID = /^[a-p]{32}$/;

/**
 * Renders the banner once into the panel's banner slot, the row right after
 * #vtt-subheader, where the orphaned-context notice and remote notifications
 * already appear. No-op when it is already there or there is no slot yet.
 */
export function showDuplicateCopyNotice(otherId: string): void {
    if (document.getElementById(NOTICE_ID)) return;
    const subheader = document.getElementById('vtt-subheader');
    if (!subheader?.parentElement) return;

    const el = document.createElement('div');
    el.id = NOTICE_ID;
    // 'status', not 'alert': nothing is broken right now — the next save is.
    el.setAttribute('role', 'status');

    const title = document.createElement('div');
    title.className = 'vtt-orphan-notice-title';
    title.textContent = t('dupCopyTitle', 'Lingogram is running twice');

    const text = document.createElement('div');
    text.className = 'vtt-orphan-notice-text';
    // Names the symptom the learner arrived with (a failed save, a sign-in
    // request while signed in), then the way out.
    text.textContent = t(
        'dupCopyText',
        'Two copies of the extension are turned on, so each word is saved twice and one of the saves fails. Turn one copy off and reload the page.',
    );

    el.appendChild(title);
    el.appendChild(text);

    // A page cannot open chrome://extensions; the worker can. The link lands on
    // the OTHER copy's own details page, where its on/off switch is.
    if (EXTENSION_ID.test(otherId)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vtt-orphan-notice-action';
        btn.textContent = t('dupCopyAction', 'Open extension settings');
        btn.addEventListener('click', () => {
            void sendMessage({ action: 'OPEN_EXTENSION_PAGE', id: otherId }).catch(() => {});
        });
        el.appendChild(btn);
    }

    subheader.insertAdjacentElement('afterend', el);
}

/**
 * Keeps the banner up for as long as another copy owns the panel. Called by the
 * copy that yielded. Removes the banner when the panel is gone or no longer
 * foreign (the other copy's page was reloaded without it). Returns a teardown.
 */
export function watchForDuplicateCopy(ownId: string): () => void {
    const tick = (): void => {
        const owner = document.getElementById('vtt-sidebar')?.dataset.vttOwner;
        if (owner && owner !== ownId) {
            showDuplicateCopyNotice(owner);
        } else {
            document.getElementById(NOTICE_ID)?.remove();
        }
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
}
