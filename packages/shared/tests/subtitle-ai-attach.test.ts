/**
 * attachAiTranslation: the loaded tracks, the display mode, the language pair
 * and the dev switch decide when an AiTranslator runs and on which track.
 * It follows AppState's events and translates only in Dual and only without
 * a native track from the site.
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

// accept: the viewer takes every offer at once (default), which is what the
// tests before "it waits to be asked" describe; false leaves offers standing.
function setup(opts: { forced?: boolean; prefs?: LanguagePrefs | null; reply?: (p: Sent['part']) => unknown; hint?: boolean; accept?: boolean; chosen?: string[]; gate?: 'open' | 'unread' } = {}) {
    const state = new AppState();
    state.setLanguagePreferences('English', 'Russian');
    let prefs = opts.prefs === undefined ? PAIR : opts.prefs;
    let forcedListener: (on: boolean) => void = () => {};
    let pairListener: () => void = () => {};
    let seekListener: () => void = () => {};
    let allowedListener: (on: boolean) => void = () => {};
    let yieldListener: () => void = () => {};
    let returnListener: () => void = () => {};
    const tabLog: string[] = [];
    const timers: (() => void)[] = [];
    const sent: Sent[] = [];
    let time = 0;
    const deps: AttachDeps = {
        send: async (msg) => {
            sent.push(msg as Sent);
            const p = (msg as Sent).part;
            if (opts.reply) return opts.reply(p);
            return { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, () => 'ru'), skipped: [] };
        },
        forced: async () => !!opts.forced,
        onForcedChange: (cb) => { forcedListener = cb; },
        onPairChange: (cb) => { pairListener = cb; },
        onSeek: (cb) => { seekListener = cb; },
        onTranslationAllowed: (cb) => {
            allowedListener = cb;
            // The gate's first answer, as watchGate gives it once storage is read.
            if (opts.gate !== 'unread') queueMicrotask(() => cb(true));
        },
        later: (fn) => { timers.push(fn); },
        currentTime: () => time,
        ...(opts.hint === undefined ? {} : { hintAllowed: async () => opts.hint! }),
        oneTab: {
            claim: () => { tabLog.push('claim'); },
            release: () => { tabLog.push('release'); },
            onYield: (cb) => { yieldListener = cb; },
            onReturn: (cb) => { returnListener = cb; },
        },
        chosen: {
            load: async () => [...chosen],
            add: (key) => { chosen.push(key); },
            remove: (key) => { chosen.splice(0, chosen.length, ...chosen.filter((k) => k !== key)); },
        },
    };
    const chosen: string[] = [...(opts.chosen ?? [])];
    const statuses: (string | null)[] = [];
    // The offer on screen: its start, or null when none is shown.
    let offer: (() => void) | null = null;
    let offerOff = false;
    let offers = 0;
    // The way to turn a running translation off, or null when none runs.
    let stopper: (() => void) | null = null;
    let listed = 0;
    const secondTracks = () => {
        listed++;
        return [];
    };
    attachAiTranslation({
        state, site: 'rezka', refresh: () => {}, langPrefs: () => prefs, setStatus: (s) => statuses.push(s),
        offer: (start, off) => {
            offer = start;
            offerOff = !!off;
            if (!start) return;
            offers++;
            if (opts.accept !== false) start();
        },
        offerStop: (stop) => { stopper = stop; },
        ...(opts.hint === undefined ? {} : { secondTracks }),
    }, deps);
    return {
        state, sent, statuses, chosen,
        offered: () => offer !== null,
        /** The standing offer reads "off": turned off on this video, on this page. */
        offeredOff: () => offer !== null && offerOff,
        offers: () => offers,
        accept: () => offer?.(),
        canStop: () => stopper !== null,
        turnOff: () => stopper?.(),
        listed: () => listed,
        seek: (t: number) => { time = t; },
        seeked: () => seekListener(),
        // Fire every pending timer once, as the browser would over time.
        runTimers: async () => {
            for (const fn of timers.splice(0)) fn();
            await settle();
        },
        setForced: (on: boolean) => forcedListener(on),
        setAllowed: (on: boolean) => allowedListener(on),
        tabLog,
        /** Another tab claimed the translation. */
        yieldTab: () => yieldListener(),
        /** The viewer came back to this tab. */
        returnTab: () => returnListener(),
        setPair: (p: LanguagePrefs | null) => { prefs = p; pairListener(); },
        aiNames: () => state.tracks.map((t) => t.name),
    };
}

describe('attachAiTranslation follows events', () => {
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

describe('attachAiTranslation translates only in Dual, only without a native track', () => {
    test('no native track and Dual: it asks', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.state.displayMode).toBe('dual');
        expect(s.sent).toHaveLength(1);
    });

    test('the site gives a native track: nothing is asked', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('Russian', cues(10, 'Ru'));
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
        expect(s.aiNames()).toEqual(['Russian', 'English']);
    });

    test('Dual -> single pauses it; Dual stays selectable and resumes it', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(300));
        await settle();
        const before = s.sent.length;
        expect(s.state.setDisplayMode('single')).toBe(true);
        s.seek(400);
        await s.runTimers();
        await s.runTimers();
        expect(s.sent).toHaveLength(before); // paused: no new requests
        expect(s.aiNames()).toEqual(['English', 'Russian · AI']); // what was filled stays
        expect(s.state.setDisplayMode('dual')).toBe(true);
        await settle();
        expect(s.sent.length).toBeGreaterThan(before);
    });

    test('Single showing the translation alone keeps it going, also when Single was already on', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(300));
        await settle();
        expect(s.state.setDisplayMode('single')).toBe(true);
        const paused = s.sent.length;
        s.seek(400);
        await s.runTimers();
        expect(s.sent).toHaveLength(paused);
        // Already in Single: no mode event, the line change alone resumes it.
        s.state.setSingleTrack('Russian · AI');
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('Russian · AI');
        await settle();
        expect(s.sent.length).toBeGreaterThan(paused);
        // Stopped, its track goes, and Single shows the learning track again.
        s.state.setLanguagePreferences('English', undefined);
        s.state.removeTrack('Russian · AI');
        expect(s.state.singleTrackName).toBeUndefined();
    });

    test('starting outside Dual with one track: Dual can be picked, and picking it starts the translator', async () => {
        const s = setup();
        await settle();
        s.state.setDisplayMode('guess');
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
        expect(s.state.setDisplayMode('dual')).toBe(true);
        await settle();
        expect(s.sent).toHaveLength(1);
    });

    test('a native track arriving mid-way stops it for good: the site wins', async () => {
        const s = setup();
        await settle();
        s.state.addTrack('English', cues(300));
        await settle();
        const before = s.sent.length;
        s.state.addTrack('Russian', cues(300, 'Ru'));
        await settle();
        expect(s.aiNames()).toEqual(['English', 'Russian']);
        s.seek(400);
        await s.runTimers();
        await s.runTimers();
        expect(s.sent).toHaveLength(before);
    });

    test('the dev switch forces it even over a native track', async () => {
        const s = setup({ forced: true });
        await settle();
        s.state.addTrack('Russian', cues(10, 'Ru'));
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(1);
        s.setForced(false);
        await settle();
        expect(s.aiNames()).toEqual(['Russian', 'English']);
    });

    test('no language pair chosen: nothing to translate into', async () => {
        const s = setup({ prefs: null });
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
    });
});

describe('attachAiTranslation asks again on a seek', () => {
    test('a part the server could not translate is asked for again after a seek, not on a timer', async () => {
        let down = true;
        const s = setup({
            reply: (p) => (down
                ? { ok: false, code: 'unavailable' }
                : { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, () => 'ru'), skipped: [] }),
        });
        await settle();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(1);
        down = false;
        await s.runTimers();
        await s.runTimers();
        expect(s.sent).toHaveLength(1);
        s.seeked();
        await settle();
        expect(s.sent).toHaveLength(2);
    });
});

describe('attachAiTranslation follows whether translation is allowed (spec 032)', () => {
    test('disallowed, it removes the AI track and asks nothing; allowed again, it translates', async () => {
        const s = setup();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.aiNames()).toEqual(['English', 'Russian · AI']);
        s.setAllowed(false);
        await settle();
        expect(s.aiNames()).toEqual(['English']);
        const asked = s.sent.length;
        s.state.addTrack('English', cues(12));
        await settle();
        expect(s.sent).toHaveLength(asked);
        s.setAllowed(true);
        await settle();
        expect(s.aiNames()).toContain('Russian · AI');
    });
});

// AI translation spends the viewer's AI credits, so it runs only on videos the
// viewer asks for: it offers, and starts when the offer is taken.
describe('attachAiTranslation waits to be asked', () => {
    test('it offers instead of starting, and asks the server nothing until the offer is taken', async () => {
        const s = setup({ accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.offered()).toBe(true);
        expect(s.sent).toHaveLength(0);
        expect(s.aiNames()).toEqual(['English']);
        s.accept();
        await settle();
        expect(s.offered()).toBe(false);
        expect(s.sent).toHaveLength(1);
        expect(s.aiNames()).toContain('Russian · AI');
    });

    test('a track the viewer chose before starts by itself, and a taken offer is remembered', async () => {
        const first = setup({ accept: false });
        first.state.addTrack('English', cues(10));
        await settle();
        first.accept();
        await settle();
        expect(first.chosen).toHaveLength(1);

        const again = setup({ accept: false, chosen: first.chosen });
        again.state.addTrack('English', cues(10));
        await settle();
        expect(again.offered()).toBe(false);
        expect(again.sent).toHaveLength(1);

        // Another track is a new choice.
        const other = setup({ accept: false, chosen: first.chosen });
        other.state.addTrack('English', cues(12));
        await settle();
        expect(other.offered()).toBe(true);
        expect(other.sent).toHaveLength(0);
    });

    test('it offers only in Dual, and takes the offer back when a native track arrives', async () => {
        const s = setup({ accept: false });
        s.state.displayMode = 'single';
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.offered()).toBe(false);
        s.state.displayMode = 'dual';
        await settle();
        expect(s.offered()).toBe(true);
        s.state.addTrack('Russian', cues(10, 'Строка'));
        await settle();
        expect(s.offered()).toBe(false);
        expect(s.sent).toHaveLength(0);
    });

    test('nothing is offered or started before the feature answer is read', async () => {
        const s = setup({ gate: 'unread', accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.offered()).toBe(false);
        expect(s.state.secondLineOnDemand).toBe(false);
        s.setAllowed(true);
        await settle();
        expect(s.offered()).toBe(true);
    });

    test('a remembered video waits for the feature answer too, and a closed gate keeps it stopped', async () => {
        const first = setup({ accept: false });
        first.state.addTrack('English', cues(10));
        await settle();
        first.accept();
        await settle();
        const s = setup({ gate: 'unread', chosen: first.chosen });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(0);
        s.setAllowed(false);
        await settle();
        expect(s.sent).toHaveLength(0);
        expect(s.offered()).toBe(false);
    });

    test('one tab at a time: it claims on start, pauses when another tab takes it, claims back on return', async () => {
        const s = setup();
        s.state.addTrack('English', cues(200));
        await settle();
        expect(s.tabLog).toEqual(['claim']);
        await s.runTimers();
        const asked = s.sent.length;
        expect(asked).toBeGreaterThan(0);

        s.yieldTab();
        s.seeked();
        await s.runTimers();
        expect(s.sent).toHaveLength(asked);

        s.returnTab();
        await settle();
        expect(s.tabLog).toEqual(['claim', 'claim']);
        s.seek(150);
        s.seeked();
        await s.runTimers();
        expect(s.sent.length).toBeGreaterThan(asked);
    });

    test('a return without a running translation claims nothing; stopping releases', async () => {
        const s = setup({ accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        s.returnTab();
        expect(s.tabLog).toEqual([]);
        s.accept();
        await settle();
        s.turnOff();
        await settle();
        expect(s.tabLog).toEqual(['claim', 'release']);
    });

    test('a running translation can be turned off: it stops, forgets the choice and offers again', async () => {
        const s = setup({ accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.canStop()).toBe(false);
        s.accept();
        await settle();
        expect(s.canStop()).toBe(true);
        const asked = s.sent.length;

        s.turnOff();
        await settle();
        expect(s.canStop()).toBe(false);
        expect(s.aiNames()).toEqual(['English']);
        expect(s.chosen).toHaveLength(0);
        expect(s.offered()).toBe(true);
        expect(s.offeredOff()).toBe(true);
        // Nothing more is asked once it is off, a seek included.
        s.seeked();
        await s.runTimers();
        expect(s.sent).toHaveLength(asked);

        // Opened again, the video waits to be asked.
        const again = setup({ accept: false, chosen: s.chosen });
        again.state.addTrack('English', cues(10));
        await settle();
        expect(again.offered()).toBe(true);
        expect(again.offeredOff()).toBe(false);
        expect(again.sent).toHaveLength(0);
    });

    test('turned off, "off" turns it back on, and a fresh offer is not "off"', async () => {
        const s = setup({ accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.offeredOff()).toBe(false);
        s.accept();
        await settle();
        s.turnOff();
        await settle();
        expect(s.offeredOff()).toBe(true);
        s.accept();
        await settle();
        expect(s.canStop()).toBe(true);
        expect(s.chosen).toHaveLength(1);
        s.turnOff();
        await settle();
        // Another video on the same page starts from a plain offer.
        s.state.reset();
        s.state.addTrack('English', cues(12));
        await settle();
        expect(s.offered()).toBe(true);
        expect(s.offeredOff()).toBe(false);
    });

    test('the way to turn it off goes with the translation: a native track or a new video takes it away', async () => {
        const s = setup();
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.canStop()).toBe(true);
        s.state.addTrack('Russian', cues(10, 'Строка'));
        await settle();
        expect(s.canStop()).toBe(false);
    });

    test('a standing offer is shown once, not again on every event', async () => {
        const s = setup({ accept: false });
        s.state.addTrack('English', cues(10));
        await settle();
        s.seeked();
        s.setPair(PAIR);
        await settle();
        expect(s.offers()).toBe(1);
    });
});

describe('attachAiTranslation hands the hint gate to the translator (spec 032)', () => {
    test.each([[false, 0], [true, 1]])('hint allowed %s: the second track is looked for %i time(s)', async (hint, times) => {
        const s = setup({ hint });
        s.state.addTrack('English', cues(10));
        await settle();
        expect(s.sent).toHaveLength(1);
        expect(s.listed()).toBe(times);
    });
});
