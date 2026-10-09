/**
 * attachAiTranslation: the switch, the language pair and the loaded tracks
 * decide when an AiTranslator runs and on which track.
 */

import { AppState } from '../src/AppState';
import { attachAiTranslation, type AttachDeps } from '../src/subtitle-ai/attach';
import type { LanguagePrefs } from '../src/languages';
import type { Subtitle } from '../src/types';

const cues = (n: number): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `Line ${i}.` }));
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(enabled: boolean, prefs: LanguagePrefs | null) {
    const state = new AppState();
    state.setLanguagePreferences('English', 'Russian');
    let tick: () => void = () => {};
    let prefsListener: (on: boolean) => void = () => {};
    const sent: Record<string, unknown>[] = [];
    const deps: AttachDeps = {
        send: async (msg) => {
            sent.push(msg as Record<string, unknown>);
            const p = (msg as { part: { from: number; to: number } }).part;
            return { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, () => 'ru') };
        },
        enabled: async () => enabled,
        onEnabledChange: (cb) => { prefsListener = cb; },
        every: (fn) => { tick = fn; },
        later: () => {},
        currentTime: () => 0,
    };
    const statuses: (string | null)[] = [];
    attachAiTranslation({ state, site: 'rezka', refresh: () => {}, langPrefs: () => prefs, setStatus: (s) => statuses.push(s) }, deps);
    return { state, sent, statuses, tick: () => tick(), toggle: (on: boolean) => prefsListener(on) };
}

const PAIR: LanguagePrefs = { learning: 'en', native: 'ru' } as LanguagePrefs;

describe('attachAiTranslation', () => {
    test('switched on, it translates the learning track once it loads', async () => {
        const s = setup(true, PAIR);
        await settle();
        s.tick();
        expect(s.sent).toHaveLength(0); // nothing loaded yet
        s.state.addTrack('English', cues(10));
        s.tick();
        await settle();
        expect(s.sent).toHaveLength(1);
        expect(s.state.tracks.map((t) => t.name)).toEqual(['English', 'Russian · AI']);
        s.tick();
        await settle();
        expect(s.sent).toHaveLength(1); // the same track is not started twice
    });

    test('switched off, nothing is asked; switching on later starts it, off again removes it', async () => {
        const s = setup(false, PAIR);
        await settle();
        s.state.addTrack('English', cues(10));
        s.tick();
        await settle();
        expect(s.sent).toHaveLength(0);

        s.toggle(true);
        s.tick();
        await settle();
        expect(s.sent).toHaveLength(1);

        s.toggle(false);
        s.tick();
        expect(s.state.tracks.map((t) => t.name)).toEqual(['English']);
        expect(s.statuses[s.statuses.length - 1]).toBeNull();
    });

    test('no language pair chosen: nothing to translate into', async () => {
        const s = setup(true, null);
        await settle();
        s.state.addTrack('English', cues(10));
        s.tick();
        await settle();
        expect(s.sent).toHaveLength(0);
    });
});
