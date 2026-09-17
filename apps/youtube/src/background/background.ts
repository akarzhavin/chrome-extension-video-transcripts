import { installAuthBackground, installOnboarding } from '@video-transcripts/shared';
// Relative paths, not the barrel, for both of these. analytics-bg carries the
// GA4 api_secret; devEnvSwitch carries the environment table that prod builds
// drop. Neither belongs in anything a content script can pull in.
import {
    markInstalled,
    onboardingClientId,
    setBackendResolver,
    track,
} from '../../../../packages/shared/src/analytics-bg';
import { currentSide } from '../../../../packages/shared/src/auth/devEnvSwitch';

chrome.runtime.onInstalled.addListener(() => {
    console.log('[YT-VTT bg] installed');
});

// Tags every event with the backend it came from. A dev build can be switched
// between its targets at runtime, so without this a test session against the
// emulators is indistinguishable from one against real data in the same dev
// property.
//
// The TARGET'S OWN NAME, not a prod/not-prod bit: a ring of three collapsed to
// two labels would file every local-emulator session under 'preprod' — a value
// that reads as real and is wrong. A prod build has one target and reports it.
setBackendResolver(() => currentSide());

installAuthBackground();
installOnboarding('youtube', {
    // Shared, not spelled out here: the opted-out placeholder rule is the same
    // for every edition, and a copy per background script is a copy that can
    // drift silently.
    clientId: onboardingClientId,
    onInstall: () => {
        // Stamps the retention clock. Installs that predate analytics have no
        // date and simply never appear in retention — deliberately, since
        // back-filling one would invent a false cohort.
        void markInstalled();
        // No `ext` param: buildPayload stamps ext_source on every hit, so
        // naming the edition here only gave it a second spelling to disagree
        // with. extension_updated below never carried one.
        void track('extension_installed');
    },
    onUpdate: (previousVersion) => {
        void track('extension_updated', { previous_version: previousVersion });
    },
});
