// Wires the two Chrome APIs that hand a visitor off to lingogram.ai's
// onboarding pages — shared by all three extensions (apps/youtube,
// apps/rezka, apps/web) so the install/uninstall behavior can't drift
// between them. `ext` is the editions.json slug ('youtube' | 'netflix' |
// 'rezka'); apps/web has no slug in that map, so its pages fall back to the
// generic "Lingogram" copy (see the site's main.js, data-ext-name).
//
// The bare (unprefixed) path is intentional, not a missed localization: the
// site renders /welcome/ and /uninstall/ once per language under /<lang>/,
// but there is no server-side Accept-Language redirect, so a hardcoded link
// can only ever point at one fixed path — English is that path's owner.
//
// The host comes from the same build-time base URL the auth flow uses
// (EXT_FRONTEND_BASE_URL, defaulting to https://lingogram.ai), so a build
// aimed at preprod or a local server sends its onboarding tabs there too
// rather than bouncing the tester back to production.
import { config } from './auth/config';

const WELCOME_URL = `${config.frontendBaseUrl}/welcome/`;
const UNINSTALL_URL = `${config.frontendBaseUrl}/uninstall/`;

/**
 * Optional lifecycle callbacks. Analytics is delivered as a hook rather than an
 * import because this module is re-exported from the package barrel and is
 * therefore reachable from content bundles — importing analytics-bg here would
 * risk pulling the GA4 api_secret into a page-readable file, and `define`-
 * substituted string literals are notoriously resistant to tree-shaking. The
 * three background entry points pass the callbacks instead, so this file keeps
 * no dependencies at all.
 */
export interface OnboardingHooks {
    onInstall?: () => void;
    onUpdate?: (previousVersion: string) => void;
}

export function installOnboarding(
    ext: 'youtube' | 'netflix' | 'rezka' | 'web',
    hooks?: OnboardingHooks,
): void {
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
            // Fire before opening the tab: the worker stays alive for the
            // chrome.tabs.create that follows, which gives the (keepalive)
            // request the best chance of leaving before teardown. This is still
            // the event most likely to be lost — treat installs as slightly
            // undercounted rather than engineering a queue for it.
            hooks?.onInstall?.();
            void chrome.tabs.create({ url: `${WELCOME_URL}?ext=${ext}` });
            return;
        }
        if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
            hooks?.onUpdate?.(details.previousVersion ?? '');
        }
    });
    chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?ext=${ext}`);
}
