// Who may talk to the worker over externally_connectable from the site: the
// frontend origins the sign-in handoff already trusts, plus (in a dev build) the
// site served locally. Shared by the welcome page's bridge and the settings
// page's, so the two cannot drift apart on which origins they accept.

import { isAllowedExternalSender } from './auth/background';

// The site served locally (apps/site, python on :8471) for testing a dev build.
// A module-level const so a prod bundle drops the origin entirely.
const DEV_SITE_ORIGIN = __EXT_ENV__ === 'dev' ? 'http://localhost:8471' : '';

export function isTrustedSiteSender(sender: chrome.runtime.MessageSender): boolean {
    if (isAllowedExternalSender(sender)) return true;
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '');
    return DEV_SITE_ORIGIN !== '' && origin === DEV_SITE_ORIGIN;
}
