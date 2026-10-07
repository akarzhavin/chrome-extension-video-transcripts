// settings.html, the manifest's options_page: a doorway, not a page.
//
// The extension's settings live in one place, the site's page for this
// extension (/app/vocab/extension), signed in or not: the site says when the
// extension is not connected to an account and connects it from there. This
// page exists so every way in (the popup's Settings, "Manage sites", Chrome's
// own "Extension options") arrives there.

import { restoreEnvForPage } from '../auth/devEnvSwitch';
import type { Edition } from '../sibling';
import { siteSettingsUrl } from '../popup/shared';

export interface SettingsOptions {
    edition: Edition;
}

/**
 * Replaces this tab with the site's settings page, keeping the anchor
 * (#highlight from "Manage sites"). A dev build first restores its chosen
 * backend: the URL names that backend's site.
 */
export async function initSettings(
    opts: SettingsOptions,
    // The tab to move; a parameter only so tests can watch it (jsdom's location cannot be replaced).
    tab: { hash: string; replace(url: string): void } = location,
): Promise<void> {
    try {
        await restoreEnvForPage();
    } catch {
        // the build's own backend, then
    }
    tab.replace(siteSettingsUrl(opts.edition) + tab.hash);
}
