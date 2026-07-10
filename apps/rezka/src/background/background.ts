import { installAuthBackground } from '@video-transcripts/shared';

// Function to download a file with automatic retry on error
export async function fetchWithRetry(url: string, retries: number = 3, delay: number = 1000): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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
                        url: request.url
                    });
                }
            })
            .catch(err => {
                console.error("Background: Failed to fetch VTT:", err);
            });
        return false;
    }
    return false;
});
