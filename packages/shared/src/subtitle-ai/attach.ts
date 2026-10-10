// Runs an AiTranslator while the learner's switch is on: on the loaded learning
// track, into their native language (english spec 023). It follows events, not
// a poll (T059): a new video (reset) stops it at once, a learning track
// arriving starts it, a new language pair restarts it.

import type { AppState, StateEvent } from '../AppState';
import { labelForLanguage, type LanguagePrefs } from '../languages';
import { AI_SUFFIX, AiTranslator, type AiStatus } from './controller';

export interface AiApp {
    state: AppState;
    site: string;
    refresh(): void;
    langPrefs(): LanguagePrefs | null;
    setStatus(s: AiStatus | null): void;
}

export interface AttachDeps {
    send(msg: object): Promise<unknown>;
    enabled(): Promise<boolean>;
    onEnabledChange(cb: (on: boolean) => void): void;
    /** The language pair changed (HDrezka changes it without a reset). */
    onPairChange(cb: () => void): void;
    later(fn: () => void, ms: number): void;
    currentTime(): number;
}

export function attachAiTranslation(app: AiApp, deps: AttachDeps): void {
    let on = false;
    let t: AiTranslator | null = null;
    const { state } = app;

    const stop = () => {
        if (!t) return;
        t.stop();
        t = null;
        app.setStatus(null);
    };

    const sync = () => {
        const prefs = app.langPrefs();
        const source = prefs
            ? state.tracks.find((tr) => !tr.name.endsWith(AI_SUFFIX) && tr.name.includes(labelForLanguage(prefs.learning)))
            : undefined;
        if (!on || !prefs || !source) return stop();
        if (t && (t.source !== source || t.learning !== prefs.learning || t.native !== prefs.native)) stop();
        if (t) return;
        t = new AiTranslator(
            {
                state,
                site: app.site,
                refresh: () => app.refresh(),
                send: deps.send,
                currentTime: deps.currentTime,
                setStatus: (s) => app.setStatus(s),
                later: deps.later,
            },
            prefs.learning,
            prefs.native,
        );
        t.start(source);
    };

    state.subscribe((e: StateEvent) => {
        if (e.type === 'reset') stop();
        if (e.type === 'track' && e.name.endsWith(AI_SUFFIX)) return; // its own track
        sync();
    });
    deps.onPairChange(sync);
    deps.onEnabledChange((v) => {
        on = v;
        sync();
    });
    void deps.enabled().then((v) => {
        on = v;
        sync();
    });
}
