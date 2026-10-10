// The real dependencies of attachAiTranslation in a content script.

import { onLanguagePrefsChanged } from '../languages';
import { sendMessageGuarded } from '../messaging';
import { loadPrefs, onPrefsChanged } from '../prefs';
import type { AttachDeps } from './attach';

export function browserAiDeps(): AttachDeps {
    return {
        send: (msg) => sendMessageGuarded(msg),
        // The dev-only switch; prefs read it as false outside a dev build.
        forced: async () => (await loadPrefs()).aiTranslate,
        onForcedChange: (cb) => {
            let last: boolean | undefined;
            onPrefsChanged((p) => {
                if (p.aiTranslate === last) return;
                last = p.aiTranslate;
                cb(p.aiTranslate);
            });
        },
        // Runs after the app's own listener (registered first), which updates its langPrefs.
        onPairChange: (cb) => {
            onLanguagePrefsChanged(() => cb());
        },
        // Media events do not bubble; a capturing listener sees every video's.
        onSeek: (cb) => {
            document.addEventListener('seeked', (e) => {
                if (e.target instanceof HTMLVideoElement) cb();
            }, true);
        },
        later: (fn, ms) => {
            setTimeout(fn, ms);
        },
        currentTime: () => document.querySelector('video')?.currentTime ?? 0,
    };
}
