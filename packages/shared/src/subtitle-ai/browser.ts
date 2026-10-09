// The real dependencies of attachAiTranslation in a content script.

import { sendMessageGuarded } from '../messaging';
import { loadPrefs, onPrefsChanged } from '../prefs';
import type { AttachDeps } from './attach';

export function browserAiDeps(): AttachDeps {
    return {
        send: (msg) => sendMessageGuarded(msg),
        enabled: async () => (await loadPrefs()).aiTranslate,
        onEnabledChange: (cb) => {
            let last: boolean | undefined;
            onPrefsChanged((p) => {
                if (p.aiTranslate === last) return;
                last = p.aiTranslate;
                cb(p.aiTranslate);
            });
        },
        every: (fn, ms) => {
            setInterval(fn, ms);
        },
        later: (fn, ms) => {
            setTimeout(fn, ms);
        },
        currentTime: () => document.querySelector('video')?.currentTime ?? 0,
    };
}
