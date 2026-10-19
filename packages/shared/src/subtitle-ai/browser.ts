// attachAiTranslation in a content script, with its real dependencies.

import type { AppState } from '../AppState';
import { platformOf } from '../analytics';
import { onLanguagePrefsChanged, type LanguagePrefs } from '../languages';
import { sendMessageGuarded } from '../messaging';
import { FEATURE_AI, FEATURE_AI_TRANSLATE, watchFeatures } from '../features';
import { loadPrefs, onPrefsChanged } from '../prefs';
import type { SidebarUI } from '../SidebarUI';
import { attachAiTranslation, type AttachDeps } from './attach';
import type { SecondCandidate } from './second';

/** What both apps have: their state, their sidebar and the language pair, read when needed. */
export interface AiTranslatedApp {
    state: AppState;
    ui: Pick<SidebarUI, 'refresh' | 'updateSecondaryLines' | 'setAiStatus'>;
    langPrefs: LanguagePrefs | null;
    /** The site's other subtitle tracks, for the gender of "I" and "you"; absent on sites not wired. */
    secondTracks?(): SecondCandidate[];
}

export function attachAiTranslationTo(app: AiTranslatedApp): void {
    attachAiTranslation({
        state: app.state,
        site: platformOf(location.hostname),
        refresh: () => app.ui.refresh(),
        refreshLines: () => app.ui.updateSecondaryLines(),
        langPrefs: () => app.langPrefs,
        setStatus: (s) => app.ui.setAiStatus(s),
        ...(app.secondTracks ? { secondTracks: () => app.secondTracks!() } : {}),
    }, browserAiDeps());
}

export function browserAiDeps(): AttachDeps {
    return {
        send: (msg) => sendMessageGuarded(msg),
        // The dev-only switch; prefs read it as false outside a dev build.
        forced: async () => (await loadPrefs()).aiTranslateForce,
        onForcedChange: (cb) => {
            let last: boolean | undefined;
            onPrefsChanged((p) => {
                if (p.aiTranslateForce === last) return;
                last = p.aiTranslateForce;
                cb(p.aiTranslateForce);
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
        // Translation needs the AI switch and its own; the server refuses it without either.
        onTranslationAllowed: (cb) => {
            watchFeatures([FEATURE_AI, FEATURE_AI_TRANSLATE], cb);
        },
        later: (fn, ms) => {
            setTimeout(fn, ms);
        },
        currentTime: () => document.querySelector('video')?.currentTime ?? 0,
    };
}
