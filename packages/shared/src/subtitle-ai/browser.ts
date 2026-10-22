// attachAiTranslation in a content script, with its real dependencies.

import type { AppState } from '../AppState';
import { platformOf } from '../analytics';
import { onLanguagePrefsChanged, type LanguagePrefs } from '../languages';
import { sendMessageGuarded } from '../messaging';
import { gateOpen, watchGate } from '../features/store';
import { loadPrefs, onPrefsChanged } from '../prefs';
import type { SidebarUI } from '../SidebarUI';
import { attachAiTranslation, type AttachDeps } from './attach';
import type { SecondCandidate } from './second';

/** What both apps have: their state, their sidebar and the language pair, read when needed. */
export interface AiTranslatedApp {
    state: AppState;
    ui: Pick<SidebarUI, 'refresh' | 'updateSecondaryLines' | 'setAiStatus' | 'setAiOffer' | 'setAiStop'>;
    langPrefs: LanguagePrefs | null;
    /** The site's other subtitle tracks, for the gender of "I" and "you"; absent on sites not wired. */
    secondTracks?(): SecondCandidate[];
    /** Another place that offers and stops the translation, beside the sidebar (HDrezka's CC menu). */
    aiControls?: AiControls;
}

/** What the sidebar's AI row is told, for a second surface to show the same. */
export interface AiControls {
    offer(start: (() => void) | null, off: boolean): void;
    stop(stop: (() => void) | null): void;
}

export function attachAiTranslationTo(app: AiTranslatedApp): void {
    attachAiTranslation({
        state: app.state,
        site: platformOf(location.hostname),
        refresh: () => app.ui.refresh(),
        refreshLines: () => app.ui.updateSecondaryLines(),
        langPrefs: () => app.langPrefs,
        setStatus: (s) => app.ui.setAiStatus(s),
        offer: (start, off = false) => {
            app.ui.setAiOffer(start, off);
            app.aiControls?.offer(start, off);
        },
        offerStop: (stop) => {
            app.ui.setAiStop(stop);
            app.aiControls?.stop(stop);
        },
        ...(app.secondTracks ? { secondTracks: () => app.secondTracks!() } : {}),
    }, browserAiDeps());
}

// The tracks the viewer chose to translate, on this device only: a key of the
// site, the language pair and the track's length, never sent anywhere. The
// newest CHOSEN_MAX are kept.
const CHOSEN_KEY = 'aiChosen';
const CHOSEN_MAX = 200;
const chosenTracks: NonNullable<AttachDeps['chosen']> = {
    load: async () => {
        const got: unknown = (await chrome.storage.local.get(CHOSEN_KEY))[CHOSEN_KEY];
        return Array.isArray(got) ? got.filter((k): k is string => typeof k === 'string') : [];
    },
    add: (key) => {
        void chosenTracks.load().then((keys) =>
            chrome.storage.local.set({ [CHOSEN_KEY]: [...keys.filter((k) => k !== key), key].slice(-CHOSEN_MAX) }),
        ).catch(() => undefined);
    },
    remove: (key) => {
        void chosenTracks.load().then((keys) =>
            chrome.storage.local.set({ [CHOSEN_KEY]: keys.filter((k) => k !== key) }),
        ).catch(() => undefined);
    },
};

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
        // Never stopped: attachAiTranslation lives as long as the page.
        onTranslationAllowed: (cb) => {
            watchGate('translation', cb);
        },
        hintAllowed: () => gateOpen('hint'),
        chosen: chosenTracks,
        later: (fn, ms) => {
            setTimeout(fn, ms);
        },
        currentTime: () => document.querySelector('video')?.currentTime ?? 0,
    };
}
