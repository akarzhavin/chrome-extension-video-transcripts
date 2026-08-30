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
    /**
     * Resolves the analytics client id for the `cid` param on both onboarding
     * URLs, so a visit to /welcome/ or /uninstall/ can be joined to the
     * install it belongs to.
     *
     * Passed in rather than imported for the same reason the analytics
     * callbacks above are: this module is reachable from content bundles, and
     * importing analytics-bg here would risk pulling the GA4 api_secret into a
     * page-readable file.
     *
     * Must resolve to OPTED_OUT when the visitor has switched analytics off —
     * see the uninstall registration below for why a placeholder rather than
     * an omitted param.
     */
    clientId?: () => Promise<string>;
}

/**
 * Stands in for the client id when analytics is off. A visitor who opted out
 * still reaches these pages — Chrome opens the uninstall URL regardless of any
 * preference of ours — and sending their real id would break the promise the
 * privacy policy makes in every locale ("collection stops immediately").
 *
 * A constant rather than a missing param so the two cases stay distinguishable
 * downstream: no `cid` at all means an old build or a failed read, while this
 * value means a working install whose owner declined. Deliberately not a
 * UUID-shaped string — nothing should be tempted to treat it as an identity,
 * and it collides across every opted-out install by design.
 */
export const OPTED_OUT = 'opted-out';

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
            // No resolver (apps/web, and any older caller): open synchronously,
            // exactly as before. Deferring the tab behind a promise nobody
            // needs would risk the worker dying first and swallowing the
            // welcome page — the one thing this branch exists to deliver.
            if (!hooks?.clientId) {
                void chrome.tabs.create({ url: `${WELCOME_URL}?ext=${ext}` });
                return;
            }
            // With a resolver, wait for it so /welcome/ carries the same id the
            // install event reported under. onInstall mints it first, so this
            // reads storage rather than racing the mint.
            void (async () => {
                const cid = await resolveCid(hooks);
                void chrome.tabs.create({
                    url: `${WELCOME_URL}?ext=${ext}${cid ? `&cid=${encodeURIComponent(cid)}` : ''}`,
                });
            })();
            return;
        }
        if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
            hooks?.onUpdate?.(details.previousVersion ?? '');
        }
    });

    // Registered immediately WITHOUT the id, then again with it: Chrome only
    // remembers the last URL set, and a worker that dies before the async read
    // finishes would otherwise leave no uninstall URL at all — the one failure
    // that costs us every uninstall answer, silently. The bare URL is a valid
    // page on its own; the second call upgrades it.
    chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?ext=${ext}`);
    void (async () => {
        const cid = await resolveCid(hooks);
        if (!cid) return;
        chrome.runtime.setUninstallURL(
            `${UNINSTALL_URL}?ext=${ext}&cid=${encodeURIComponent(cid)}`,
        );
    })();
}

/**
 * Never throws and never returns a half-answer: any failure yields '' and the
 * URL simply carries no `cid`. An onboarding link is not worth losing over an
 * analytics read.
 */
async function resolveCid(hooks?: OnboardingHooks): Promise<string> {
    if (!hooks?.clientId) return '';
    try {
        return (await hooks.clientId()) || '';
    } catch {
        return '';
    }
}
