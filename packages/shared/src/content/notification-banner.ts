// The remote-notification banner: one row under the sub-header carrying a
// message we published without shipping a release (see ../notifications.ts).
//
// Placement is a sibling right after #vtt-subheader, the same slot and the same
// insertAdjacentElement('afterend') trick #vtt-partial-notice uses. Two reasons
// it does not reuse #vtt-status: that banner sits before #vtt-list and pushes
// the transcript down, and #vtt-lang-onboarding suppresses it unconditionally —
// so a user who had not picked languages yet would never see the message.
//
// Shared rather than duplicated because rezka does not extend BaseVttApp: it
// has its own parallel content script, and both editions call this one function.

import { msg as i18nMsg } from '../i18n';
import {
    DISMISS_NOTIFICATION_ACTION,
    GET_NOTIFICATION_ACTION,
    RemoteNotification,
} from '../notification-types';

const BANNER_ID = 'vtt-notification';

/** Fire-and-forget: the dismissal is recorded by the service worker. */
function sendDismiss(id: string): void {
    try {
        chrome.runtime.sendMessage({ action: DISMISS_NOTIFICATION_ACTION, id }, () => {
            // Reading lastError is what suppresses Chrome's "unchecked
            // runtime.lastError" console noise when the worker is asleep.
            void chrome.runtime.lastError;
        });
    } catch {
        /* the banner is already gone from the DOM; nothing to recover */
    }
}

/** Removes the banner if present. Safe to call when there is none. */
export function removeNotificationBanner(): void {
    document.getElementById(BANNER_ID)?.remove();
}

/**
 * Renders `n` under the sub-header, replacing any banner already there. Passing
 * null just clears it.
 *
 * Torn down and rebuilt on every call rather than patched in place — the same
 * shape updatePartialFailureNotice() uses, and it keeps a severity change or a
 * dropped close button from leaving stale classes and handlers behind.
 */
export function renderNotificationBanner(n: RemoteNotification | null): void {
    removeNotificationBanner();
    if (!n) return;

    const subheader = document.getElementById('vtt-subheader');
    if (!subheader?.parentElement) return;

    const el = document.createElement('div');
    el.id = BANNER_ID;
    el.className = `vtt-notification is-${n.severity}`;
    // Announced when it appears: the user is mid-video and not looking at the
    // panel. 'assertive' only for critical — anything less should not interrupt.
    el.setAttribute('role', n.severity === 'critical' ? 'alert' : 'status');
    el.setAttribute('aria-live', n.severity === 'critical' ? 'assertive' : 'polite');

    const title = document.createElement('div');
    title.className = 'vtt-notification-title';
    // textContent throughout: this copy is authored in the Firebase Console and
    // must never be able to inject markup into the page.
    title.textContent = n.title;
    el.appendChild(title);

    const body = document.createElement('div');
    body.className = 'vtt-notification-text';
    body.textContent = n.body;
    el.appendChild(body);

    if (n.dismissible) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'vtt-notification-close';
        close.textContent = '×';
        const label = i18nMsg('ytNotificationClose', 'Dismiss');
        close.title = label;
        close.setAttribute('aria-label', label);
        close.addEventListener('click', () => {
            removeNotificationBanner();
            sendDismiss(n.id);
        });
        el.appendChild(close);
    }

    subheader.insertAdjacentElement('afterend', el);
}

/**
 * Asks the worker for a notification and renders it. Both editions call this
 * once the sidebar exists.
 *
 * `platform` is passed in because only the content script knows the hostname —
 * the worker has no page location. Version, edition and locale are filled in
 * here so neither caller has to remember the shape.
 *
 * Never rejects: a notification that does not arrive is simply not shown. The
 * worker already swallows its own failures, so this catch only covers the
 * messaging hop (worker asleep, extension mid-reload).
 */
export async function fetchAndRenderNotification(platform: string): Promise<void> {
    try {
        const version = chrome.runtime.getManifest().version;
        const locale = chrome.i18n?.getUILanguage?.() ?? 'en';
        const res = await new Promise<{ notification?: RemoteNotification | null } | undefined>(
            (resolve) => {
                chrome.runtime.sendMessage(
                    { action: GET_NOTIFICATION_ACTION, version, platform, locale },
                    (r) => {
                        void chrome.runtime.lastError;
                        resolve(r as { notification?: RemoteNotification | null } | undefined);
                    },
                );
            },
        );
        renderNotificationBanner(res?.notification ?? null);
    } catch {
        /* no banner is the correct outcome of a failed lookup */
    }
}
