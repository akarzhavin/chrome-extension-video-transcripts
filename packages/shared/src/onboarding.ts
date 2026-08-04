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

export function installOnboarding(ext: 'youtube' | 'netflix' | 'rezka' | 'web'): void {
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
        void chrome.tabs.create({ url: `${WELCOME_URL}?ext=${ext}` });
    });
    chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?ext=${ext}`);
}
