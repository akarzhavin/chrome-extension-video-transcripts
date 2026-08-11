import { installAuthBackground, installOnboarding } from '@video-transcripts/shared';
// Relative paths, not the barrel, for both of these. analytics-bg carries the
// GA4 api_secret; devEnvSwitch carries the environment table that prod builds
// drop. Neither belongs in anything a content script can pull in.
import {
    markInstalled,
    setBackendResolver,
    track,
} from '../../../../packages/shared/src/analytics-bg';
import { isLiveProd } from '../../../../packages/shared/src/auth/devEnvSwitch';

chrome.runtime.onInstalled.addListener(() => {
    console.log('[YT-VTT bg] installed');
});

// Tags every event with the backend it came from. A dev build can be switched
// between prod and preprod at runtime, so without this a preprod test session
// is indistinguishable from one against real data in the same dev property.
setBackendResolver(() => (isLiveProd() ? 'prod' : 'preprod'));

installAuthBackground();
installOnboarding('youtube', {
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
