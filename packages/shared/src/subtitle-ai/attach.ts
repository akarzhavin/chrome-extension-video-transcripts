// Runs an AiTranslator on the loaded learning track, into the learner's native
// language, driven by AppState's events: a new video (reset) stops it at once,
// a learning track arriving starts it, a new language pair restarts it. It
// translates only in Dual and only when the site gives no native track:
// leaving Dual pauses it, a native track arriving stops it for good. The dev
// switch forces it over a native track.

import type { AppState, StateEvent } from '../AppState';
import { labelForLanguage, type LanguagePrefs } from '../languages';
import { AI_SUFFIX, AiTranslator, type AiHost } from './controller';

/** The page's side of the host; the browser's side comes with AttachDeps. */
export type AiApp = Omit<AiHost, keyof BrowserSide> & { langPrefs(): LanguagePrefs | null };

type BrowserSide = Pick<AiHost, 'send' | 'currentTime' | 'later'>;

export interface AttachDeps extends BrowserSide {
    /** The dev-only switch: translate even over a native track. */
    forced(): Promise<boolean>;
    onForcedChange(cb: (on: boolean) => void): void;
    /** The language pair changed (HDrezka changes it without a reset). */
    onPairChange(cb: () => void): void;
    /** The viewer seeked: a part the server could not translate is asked again. */
    onSeek(cb: () => void): void;
}

export function attachAiTranslation(app: AiApp, deps: AttachDeps): void {
    let forced = false;
    let t: AiTranslator | null = null;
    const { state } = app;

    const stop = () => {
        if (!t) return;
        t.stop();
        t = null;
        app.setStatus?.(null);
    };

    const sync = () => {
        const prefs = app.langPrefs();
        const own = (name: string) => !name.endsWith(AI_SUFFIX);
        const source = prefs
            ? state.tracks.find((tr) => own(tr.name) && tr.name.includes(labelForLanguage(prefs.learning)))
            : undefined;
        const native = !!prefs && state.tracks.some((tr) => own(tr.name) && tr.name.includes(labelForLanguage(prefs.native)));
        // The site's own track always wins, unless the dev switch forces it.
        const wanted = !!prefs && !!source && (forced || !native);
        state.secondLineOnDemand = wanted;
        if (!wanted) return stop();
        if (t && (t.source !== source || t.learning !== prefs!.learning || t.native !== prefs!.native)) stop();
        if (!t) {
            if (state.displayMode !== 'dual') return;
            const { send, currentTime, later } = deps;
            t = new AiTranslator({ ...app, send, currentTime, later }, prefs!.learning, prefs!.native);
            t.start(source!);
            return;
        }
        t.setPaused(state.displayMode !== 'dual');
    };

    state.subscribe((e: StateEvent) => {
        if (e.type === 'reset') stop();
        if (e.type === 'track' && e.name.endsWith(AI_SUFFIX)) return; // its own track
        sync();
    });
    deps.onPairChange(sync);
    deps.onSeek(() => t?.viewerEvent());
    deps.onForcedChange((on) => {
        forced = on;
        sync();
    });
    void deps.forced().then((on) => {
        forced = on;
        sync();
    });
}
