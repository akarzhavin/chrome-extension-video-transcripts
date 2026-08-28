import { installAuthBackground, installOnboarding } from '@video-transcripts/shared';
// Relative paths, not the barrel: analytics-bg carries the GA4 api_secret and
// must stay out of anything a content script can pull in.
import {
    markInstalled,
    setBackendResolver,
    track,
} from '../../../../packages/shared/src/analytics-bg';
import { isLiveProd } from '../../../../packages/shared/src/auth/devEnvSwitch';

// Tags every event with the backend it came from — a dev build can be switched
// between prod and preprod at runtime, and the two must stay distinguishable.
setBackendResolver(() => (isLiveProd() ? 'prod' : 'preprod'));

/**
 * Carries the HTTP status alongside the error so callers can tell a rate limit
 * from a dead link. Previously the status was formatted into a message string
 * and lost, which is why the UI blamed the video for what was often throttling.
 */
export class HttpError extends Error {
    constructor(readonly status: number) {
        super(`HTTP error! status: ${status}`);
        this.name = 'HttpError';
    }
}

/** Maps a status onto the same failure vocabulary the YouTube edition uses. */
export function classifyStatus(status: number | undefined): string {
    if (status === 429 || status === 503) return 'rate-limited';
    if (status === 403) return 'stale-url';
    if (status === 404 || status === 410) return 'unavailable';
    if (typeof status === 'number' && status > 0) return 'unknown';
    return 'network';
}

// Function to download a file with automatic retry on error
export async function fetchWithRetry(url: string, retries: number = 3, delay: number = 1000): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new HttpError(response.status);
            return await response.text();
        } catch (err: any) {
            console.warn(`Fetch attempt ${i + 1} failed for ${url}:`, err.message);
            if (i < retries - 1) {
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

installAuthBackground();
installOnboarding('rezka', {
    onInstall: () => {
        void markInstalled();
        // See the youtube edition: ext_source already carries this.
        void track('extension_installed');
    },
    onUpdate: (previousVersion) => {
        void track('extension_updated', { previous_version: previousVersion });
    },
});

interface VttMessage {
    action: 'TIME_UPDATE' | 'SEEK_VIDEO' | 'VTT_LOADED' | 'FETCH_VTT' | 'RESCAN' | 'DEV_LOAD_LOCALE';
    [k: string]: unknown;
}

// Message Relay for data exchange between frames + VTT download requests.
// RESCAN is fanned out to every frame so the top-window "Search again" button
// reaches the player iframe's detector.
chrome.runtime.onMessage.addListener((request: VttMessage, sender, sendResponse) => {
    // DEV-ONLY: read a locale's messages.json (the SW can fetch extension
    // resources without web_accessible_resources) so the content script can force
    // that locale via setI18nOverride. Compiled out of prod via __EXT_ENV__.
    if (__EXT_ENV__ === 'dev' && request.action === "DEV_LOAD_LOCALE") {
        const loc = String(request.locale || '').replace(/[^a-z_-]/gi, '');
        fetch(chrome.runtime.getURL(`_locales/${loc}/messages.json`))
            .then(r => r.json())
            .then((json: Record<string, { message: string }>) => {
                const map: Record<string, string> = {};
                for (const k in json) map[k] = json[k].message;
                sendResponse({ ok: true, map });
            })
            .catch(err => sendResponse({ ok: false, error: String(err) }));
        return true; // keep the channel open for the async sendResponse
    }
    if (request.action === "TIME_UPDATE" || request.action === "SEEK_VIDEO" || request.action === "VTT_LOADED" || request.action === "RESCAN") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
        return false;
    }
    if (request.action === "FETCH_VTT") {
        fetchWithRetry(request.url as string)
            .then(text => {
                if (sender.tab && sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "VTT_LOADED",
                        payload: text,
                        url: request.url,
                        // The player's own name for this track, when the CDN
                        // listing gave one. Without it the content script can
                        // only guess a name from the cue text, which cannot
                        // separate two tracks in the same language.
                        label: request.label
                    });
                }
            })
            .catch(err => {
                console.error("Background: Failed to fetch VTT:", err);
                // Tell the page WHY. Swallowing this here is what left the
                // content script with nothing but a timeout, so it reported
                // "this video has no subtitles" for what was often a 429.
                if (sender.tab && sender.tab.id) {
                    const status = err instanceof HttpError ? err.status : undefined;
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "VTT_LOAD_FAILED",
                        url: request.url,
                        status,
                        failure: classifyStatus(status),
                    });
                }
            });
        return false;
    }
    return false;
});
