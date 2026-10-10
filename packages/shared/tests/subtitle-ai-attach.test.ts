/**
 * attachAiTranslation: the switch, the loaded tracks and the language pair
 * decide when an AiTranslator runs and on which track.
 * It follows AppState's events (T059), not a poll.
 */

import { AppState } from '../src/AppState';
import { attachAiTranslation, type AttachDeps } from '../src/subtitle-ai/attach';
import type { LanguagePrefs } from '../src/languages';
import type { Subtitle } from '../src/types';

const cues = (n: number, tag = 'Line'): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `${tag} ${i}.` }));
const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const PAIR: LanguagePrefs = { learning: 'en', native: 'ru' } as LanguagePrefs;

type Sent = { part: { fingerprint: string; from: number; to: number } };

function setup(opts: { enabled?: boolean; prefs?: LanguagePrefs | null } = {}) {
    const state = new AppState();
    state.setLanguagePreferences('English', 'Russian');
    let prefs = opts.prefs === undefined ? PAIR : opts.prefs;
    let switchListener: (on: boolean) => void = () => {};
    let pairListener: () => void = () => {};
    const timers: (() => void)[] = [];
    const sent: Sent[] = [];
    let time = 0;
    const deps: AttachDeps = {
        send: async (msg) => {
            sent.push(msg as Sent);
            const p = (msg as Sent).part;
            return { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, () => 'ru'), skipped: [] };
        },
        enabled: async () => opts.enabled ?? true,
        onEnabledChange: (cb) => { switchListener = cb; },
        onPairChange: (cb) => { pairListener = cb; },
        later: (fn) => { timers.push(fn); },
        currentTime: () => time,
    };
    const statuses: (string | null)[] = [];
    attachAiTranslation({ state, site: 'rezka', refresh: () => {}, langPrefs: () => prefs, setStatus: (s) => statuses.push(s) }, deps);
    return {
        state, sent, statuses,
        seek: (t: number) => { time = t; },
        // Fire every pending timer once, as the browser would over time.
        runTimers: async () => {
            for (const fn of timers.splice(0)) fn();
            await settle();
        },
        toggle: (on: boolean) => switchListener(on),
        setPair: (p: LanguagePrefs | null) => { prefs = p; pairListener(); },
        aiNames: () => state.tracks.map((t) => t.name),
    };
}

describe('attachAiTranslation follows events (T059)', () => {
    test('a learning track arriving starts the translator at once, no poll', async () => {
        const s = setup();
        await settle();
        expect(s.sent).toHaveLength(0);
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(1);
        expect(s.aiNames()).toEqual(['English', 'Russian · AI']);
    });

    test('a switch to a video without the track asks the server nothing more', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(300));
        await settle();
        const before = s.sent.length; // the part at playback and the next one
        expect(before).toBeGreaterThan(0);
        s.state.reset(); // the next video: no learning track
        s.state.addTrack('Russian', cues(300, 'Ru'));
        s.seek(400); // where the old film's later parts would be asked for
        await s.runTimers();
        await s.runTimers();
        expect(s.sent).toHaveLength(before);
    });

    test('a switch to a video with the track stops the old translator and starts a new one', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(300));
        await settle();
        const first = s.sent[0].part.fingerprint;
        const before = s.sent.length;
        s.state.reset();
        s.state.addTrack('English', cues(300, 'Other'));
        await settle();
        s.seek(400);
        await s.runTimers();
        await s.runTimers();
        const after = s.sent.slice(before).map((m) => m.part.fingerprint);
        expect(after.length).toBeGreaterThan(0);
        expect(after).not.toContain(first);
        expect(s.aiNames().filter((n) => n.endsWith(' · AI'))).toHaveLength(1);
    });

    test('a changed language pair restarts it, and no pair stops it (HDrezka changes it without a reset)', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        s.state.setLanguagePreferences('English', 'German');
        s.setPair({ learning: 'en', native: 'de' } as LanguagePrefs);
        await settle();
        expect(s.sent.map((m) => (m as unknown as { part: { lang: string } }).part.lang)).toEqual(['ru', 'de']);
        expect(s.aiNames()).toEqual(['English', 'German · AI']);
        s.setPair(null);
        await settle();
        expect(s.aiNames()).toEqual(['English']);
        expect(s.statuses[s.statuses.length - 1]).toBeNull();
    });
});


describe('attachAiTranslation and its switch', () => {
    test('switched off, nothing is asked; switching on starts it, off again removes it', async () => {
        const s = setup({ enabled: false });
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
        s.toggle(true);
        await settle();
        expect(s.sent).toHaveLength(1);
        s.toggle(false);
        expect(s.aiNames()).toEqual(['English']);
        expect(s.statuses[s.statuses.length - 1]).toBeNull();
    });

    test('no language pair chosen: nothing to translate into', async () => {
        const s = setup({ prefs: null });
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
    });
});
