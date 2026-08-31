// The "extension updated, reload the page" banner.
//
// When an extension is reloaded — a Chrome Web Store auto-update mid-video, or
// a local rebuild — Chrome tears the old content script's context away but
// leaves everything it built standing. The sidebar keeps its DOM, its parsed
// tracks and its scroll position, so it looks alive; what it can no longer do
// is talk to the service worker. On rezka that means `timeupdate` stops
// reaching the worker and the transcript freezes on whatever line was showing,
// with no highlight and no overlay, while the video plays on.
//
// Nothing announced this. The only string in the product about a reload lives
// in quick-add's catch block, so it surfaced solely if the user happened to
// click a word to save it — a viewer just watching got silence.
//
// Two facts drive the implementation:
//
//   1. The whole `chrome.*` surface goes, not just `runtime.id`: in a measured
//      orphaned tab `chrome.i18n` and `chrome.storage` were both `undefined`.
//      So this banner cannot call msg() — chrome.i18n.getMessage would throw at
//      the moment it is needed most. Every string here is an inline literal,
//      and that is deliberate, not an oversight of the i18n pass.
//   2. There is no event for it. Chrome fires nothing when it orphans a
//      context, so the loss has to be noticed by polling `chrome.runtime.id`.

const NOTICE_ID = 'vtt-orphan-notice';

/**
 * How often to test the context. The check is two property reads, so the cost
 * is noise; 2s bounds how long a frozen panel can look healthy after an update.
 */
const POLL_MS = 2000;

/**
 * True once the context is gone. `chrome.runtime.id` flips to undefined on an
 * orphaned script while the `chrome` global itself stays — see the module note.
 *
 * Wrapped in try/catch because in a fully torn-down context even reading the
 * property can throw, and a detector that throws is a detector that never
 * reports.
 */
export function isContextOrphaned(): boolean {
    try {
        return !chrome?.runtime?.id;
    } catch {
        return true;
    }
}

/**
 * Renders the notice once, into the panel's banner slot: the row right after
 * #vtt-subheader, which #vtt-notification and #vtt-partial-notice already
 * share. Announcements belong in one place, and this is where a reader of this
 * panel already looks for them.
 *
 * Not #vtt-status, the other banner-shaped thing: that one is built by each
 * edition's app object, is suppressed outright while #vtt-lang-onboarding is
 * up, and sits before #vtt-list where a scrolled transcript pushes it out of
 * view. This message has to be readable in every one of those states, because
 * the panel is dead in all of them.
 */
export function showOrphanNotice(): void {
    if (document.getElementById(NOTICE_ID)) return;
    const subheader = document.getElementById('vtt-subheader');
    if (!subheader?.parentElement) return;

    const el = document.createElement('div');
    el.id = NOTICE_ID;
    // The panel is stale, which is a state the user has to act on to leave —
    // 'alert', so a screen reader interrupts rather than queueing it behind a
    // transcript nobody is updating any more.
    el.setAttribute('role', 'alert');

    const title = document.createElement('div');
    title.className = 'vtt-orphan-notice-title';
    title.textContent = 'Lingogram was updated';

    const text = document.createElement('div');
    text.className = 'vtt-orphan-notice-text';
    // Says what is wrong with what they are looking at, not just what to do:
    // the panel showing stale lines is the symptom they arrived with.
    text.textContent =
        'This panel has stopped following the video. Reload the page to use it again.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vtt-orphan-notice-action';
    btn.textContent = '⟳ Reload page';
    // location.reload() needs no extension context — which is the entire reason
    // this button can be offered at all. Everything else in the panel is dead.
    btn.addEventListener('click', () => location.reload());

    el.appendChild(title);
    el.appendChild(text);
    el.appendChild(btn);

    // The banner slot, exactly as the other two announcements mount into it.
    subheader.insertAdjacentElement('afterend', el);
}

/**
 * Starts watching for the context being torn away, and shows the notice when it
 * is. Returns a teardown for embeds that remount (packages/embed); the
 * extensions live for the page's lifetime and can ignore it.
 *
 * Safe to call from any frame: without a #vtt-sidebar (iframes get none)
 * showOrphanNotice is a no-op, and the interval stops itself once it has fired.
 */
export function watchForOrphanedContext(): () => void {
    // Already orphaned before we started — a script injected into a page whose
    // extension was reloaded in between. Rare, but the poll below would make
    // the user wait POLL_MS to hear about a state that is already true.
    if (isContextOrphaned()) {
        showOrphanNotice();
        return () => {};
    }

    const timer = setInterval(() => {
        if (!isContextOrphaned()) return;
        showOrphanNotice();
        // One-shot: the context never comes back, so a live interval past this
        // point is a wakeup that can only ever re-confirm the same thing.
        clearInterval(timer);
    }, POLL_MS);

    return () => clearInterval(timer);
}
