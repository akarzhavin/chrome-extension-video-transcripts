// Runs an AiTranslator while the learner's switch is on: on the loaded learning
// track, into their native language, restarted when either changes (a new
// video resets the tracks, a new pair changes the languages).

import type { AppState } from '../AppState';
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
    every(fn: () => void, ms: number): void;
    later(fn: () => void, ms: number): void;
    currentTime(): number;
}

const POLL_MS = 1500;

export function attachAiTranslation(app: AiApp, deps: AttachDeps): void {
    let on = false;
    let t: AiTranslator | null = null;

    const sync = () => {
        const prefs = app.langPrefs();
        if (!on || !prefs) {
            if (t) {
                t.stop();
                t = null;
                app.setStatus(null);
            }
            return;
        }
        const label = labelForLanguage(prefs.learning);
        const source = app.state.tracks.find((tr) => tr.name.includes(label) && !tr.name.endsWith(AI_SUFFIX));
        if (!source) return;
        if (t && t.source === source && t.learning === prefs.learning && t.native === prefs.native) return;
        t?.stop();
        t = new AiTranslator(
            {
                state: app.state,
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

    void deps.enabled().then((v) => {
        on = v;
        sync();
    });
    deps.onEnabledChange((v) => {
        on = v;
        sync();
    });
    deps.every(sync, POLL_MS);
}
