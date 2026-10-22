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
export type AiApp = Omit<AiHost, keyof BrowserSide> & {
    langPrefs(): LanguagePrefs | null;
    /**
     * Show the offer to translate, start being what taking it does; null takes
     * it back. `off`: the viewer turned it off on this video, so it reads as a
     * switch that is off rather than as a new offer.
     */
    offer?(start: (() => void) | null, off?: boolean): void;
    /** Show the way to turn a running translation off; null takes it away. */
    offerStop?(stop: (() => void) | null): void;
};

type BrowserSide = Pick<AiHost, 'send' | 'currentTime' | 'later' | 'hintAllowed'>;

export interface AttachDeps extends BrowserSide {
    /** The dev-only switch: translate even over a native track. */
    forced(): Promise<boolean>;
    onForcedChange(cb: (on: boolean) => void): void;
    /** The language pair changed (HDrezka changes it without a reset). */
    onPairChange(cb: () => void): void;
    /** The viewer seeked: a part the server could not translate is asked again. */
    onSeek(cb: () => void): void;
    /** Whether the account may use AI translation (spec 032), now and on every change; absent, always. */
    onTranslationAllowed?(cb: (allowed: boolean) => void): void;
    /** The tracks the viewer chose to translate, kept on the device; absent, none are remembered. */
    chosen?: { load(): Promise<string[]>; add(key: string): void; remove(key: string): void };
    /**
     * One tab translates at a time (one-tab.ts): claimed on start and on the
     * viewer's return to the tab, released on stop; onYield, another tab took it.
     */
    oneTab?: { claim(): void; release(): void; onYield(cb: () => void): void; onReturn(cb: () => void): void };
}

export function attachAiTranslation(app: AiApp, deps: AttachDeps): void {
    let forced = false;
    // Closed until the account's feature answer is read: before that, a
    // remembered video would start, and a fresh one be offered, for an
    // account the server then refuses.
    let allowed = !deps.onTranslationAllowed;
    let t: AiTranslator | null = null;
    // Another tab took the translation: paused here until the viewer is back.
    let yielded = false;
    const { state } = app;
    // AI translation spends the viewer's AI credits, so it starts only on a
    // track the viewer asked for: by taking the offer, now or on an earlier
    // visit (remembered on the device). Until the list is read nothing starts
    // and nothing is offered, so a remembered track does not flash an offer.
    const chosen = new Set<string>();
    // Turned off here, while the page is open: offered again as "off".
    const turnedOff = new Set<string>();
    let chosenRead = !deps.chosen;
    let offered: string | null = null;
    const keyOf = (source: { subtitles: { endTime: number }[] }, prefs: LanguagePrefs) =>
        `${app.site}:${prefs.learning}>${prefs.native}:${source.subtitles.length}:${source.subtitles[source.subtitles.length - 1]?.endTime ?? 0}`;
    const withdraw = () => {
        if (offered === null) return;
        offered = null;
        app.offer?.(null);
    };

    const stop = () => {
        withdraw();
        if (!t) return;
        t.stop();
        t = null;
        yielded = false;
        state.aiAlone = false;
        deps.oneTab?.release();
        app.offerStop?.(null);
        app.setStatus?.(null);
    };
    // Turned off by the viewer: the choice is forgotten, so the video waits
    // to be asked again, here and on the next visit.
    const turnOff = (key: string) => {
        chosen.delete(key);
        turnedOff.add(key);
        deps.chosen?.remove(key);
        stop();
        sync();
    };

    const sync = () => {
        const prefs = app.langPrefs();
        const own = (name: string) => !name.endsWith(AI_SUFFIX);
        const source = prefs
            ? state.tracks.find((tr) => own(tr.name) && tr.name.includes(labelForLanguage(prefs.learning)))
            : undefined;
        const native = !!prefs && state.tracks.some((tr) => own(tr.name) && tr.name.includes(labelForLanguage(prefs.native)));
        // The site's own track always wins, unless the dev switch forces it.
        const wanted = allowed && !!prefs && !!source && (forced || !native);
        state.secondLineOnDemand = wanted;
        state.secondLineLanguage = wanted ? prefs!.native : undefined;
        if (!wanted) return stop();
        if (t && (t.source !== source || t.learning !== prefs!.learning || t.native !== prefs!.native)) stop();
        if (!t) {
            if (state.displayMode !== 'dual' || !chosenRead) return withdraw();
            const key = keyOf(source!, prefs!);
            if (!forced && !chosen.has(key)) {
                if (offered === key) return;
                withdraw();
                offered = key;
                app.offer?.(() => {
                    if (offered !== key) return;
                    turnedOff.delete(key);
                    chosen.add(key);
                    deps.chosen?.add(key);
                    withdraw();
                    sync();
                }, turnedOff.has(key));
                return;
            }
            withdraw();
            const { send, currentTime, later, hintAllowed } = deps;
            const running = new AiTranslator({ ...app, send, currentTime, later, hintAllowed }, prefs!.learning, prefs!.native);
            t = running;
            app.offerStop?.(() => {
                if (t === running) turnOff(key);
            });
            yielded = false;
            deps.oneTab?.claim();
            running.start(source!);
            return;
        }
        // Paused outside Dual, unless it is the one line shown (aiAlone).
        t.setPaused((state.displayMode !== 'dual' && !(state.aiAlone && state.displayMode === 'single')) || yielded);
    };

    state.subscribe((e: StateEvent) => {
        if (e.type === 'reset') stop();
        if (e.type === 'track' && e.name.endsWith(AI_SUFFIX)) return; // its own track
        sync();
    });
    void deps.chosen?.load().then((keys) => {
        for (const k of keys) chosen.add(k);
    }, () => undefined).finally(() => {
        chosenRead = true;
        sync();
    });
    deps.onPairChange(sync);
    deps.oneTab?.onYield(() => {
        if (!t) return;
        yielded = true;
        sync();
    });
    deps.oneTab?.onReturn(() => {
        if (!t || !yielded) return;
        yielded = false;
        deps.oneTab?.claim();
        sync();
    });
    deps.onSeek(() => t?.viewerEvent());
    deps.onTranslationAllowed?.((on) => {
        allowed = on;
        sync();
    });
    deps.onForcedChange((on) => {
        forced = on;
        sync();
    });
    void deps.forced().then((on) => {
        forced = on;
        sync();
    });
}
