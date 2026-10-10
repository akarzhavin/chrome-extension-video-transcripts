/**
 * The content-script half of server-side subtitle translation: an AI track in
 * the native language, filled part by part ahead of playback.
 */

import { AppState } from '../src/AppState';
import { AiTranslator, type AiHost, type AiStatus } from '../src/subtitle-ai/controller';
import type { Subtitle } from '../src/types';

const cues = (n: number): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `Line ${i}.` }));

type Reply = Record<string, unknown>;

function host(replies: ((msg: Reply) => Reply)[], time = 0) {
    const sent: Reply[] = [];
    const timers: (() => void)[] = [];
    const delays: number[] = [];
    const statuses: AiStatus[] = [];
    let refreshed = 0;
    const h: AiHost & { sent: Reply[]; timers: (() => void)[]; delays: number[]; statuses: AiStatus[]; refreshed: () => number; time: number } = {
        state: new AppState(),
        site: 'rezka',
        sent,
        timers,
        delays,
        statuses,
        time,
        refreshed: () => refreshed,
        refresh: () => { refreshed++; },
        currentTime: () => h.time,
        send: async (msg: object) => {
            sent.push(msg as Reply);
            const next = replies.shift();
            if (!next) throw new Error(`unexpected message ${JSON.stringify(msg).slice(0, 80)}`);
            return next(msg as Reply);
        },
        setStatus: (s) => { statuses.push(s); },
        later: (fn, ms) => { timers.push(fn); delays.push(ms); },
    };
    h.state.setLanguagePreferences('English', 'Russian');
    return h;
}

const lines = (m: Reply) => {
    const p = m.part as { from: number; to: number };
    return { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, (_, k) => `ru ${p.from + k}`) };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('AiTranslator', () => {
    test('adds the native AI track, seats it as the second line, and fills it from the server', async () => {
        const h = host([lines]);
        h.state.addTrack('English', cues(120));
        const t = new AiTranslator(h, 'en', 'ru');
        t.start(h.state.tracks[0]);
        await settle();

        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(h.state.tracks[h.state.secondaryTrackIndex]).toBe(ai);
        expect(h.sent[0]).toMatchObject({ action: 'SUBTITLE_AI_PART', part: { lang: 'ru', from: 0, to: 20 } });
        expect((h.sent[0].part as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(ai.subtitles[5].text).toBe('ru 5');
        expect(ai.subtitles[5].startTime).toBe(10);
        expect(h.refreshed()).toBeGreaterThan(0);
        expect(h.statuses).toContain('ready');
    });

    test('asks first for the part around playback, then the parts after it', async () => {
        const h = host([lines, lines], 900); // cue 450
        h.state.addTrack('English', cues(1000));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        await settle();
        expect(h.sent.map((m) => (m.part as { from: number }).from)).toEqual([420, 520]);
    });

    test('the backend grid: a 20-cue first part, then steps of 100', async () => {
        const h = host([lines, lines, lines]);
        h.state.addTrack('English', cues(250));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        await settle();
        expect(h.sent.map((m) => [(m.part as { from: number }).from, (m.part as { to: number }).to])).toEqual([[0, 20], [20, 120]]);
    });

    test('cues of the part being translated are marked pending; later parts are not', async () => {
        let release!: (r: Reply) => void;
        const h = host([(m) => new Promise<Reply>((r) => { release = () => r(lines(m)); }) as unknown as Reply]);
        h.state.addTrack('English', cues(250));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai.subtitles[0].pending).toBe(true);
        expect(ai.subtitles[19].pending).toBe(true);
        expect(ai.subtitles[20].pending).toBeFalsy();
        release({});
        await settle();
        expect(ai.subtitles[0]).toMatchObject({ text: 'ru 0' });
        expect(ai.subtitles[0].pending).toBeFalsy();
    });

    test('a waiting retry stays pending; a stop clears the marks', async () => {
        const h = host([() => ({ ok: false, code: 'unavailable', retryAfterMs: 10000 })]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai.subtitles[3].pending).toBe(true);

        const h2 = host([() => ({ ok: false, code: 'quota', resetsAt: 1 })]);
        h2.state.addTrack('English', cues(10));
        new AiTranslator(h2, 'en', 'ru').start(h2.state.tracks[0]);
        await settle();
        const ai2 = h2.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai2.subtitles.some((c) => c.pending)).toBe(false);
    });

    test('an unknown track is stored once, then asked for again', async () => {
        const h = host([() => ({ ok: false, code: 'track_unknown' }), () => ({ ok: true }), lines]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle(); await settle(); await settle();
        expect(h.sent.map((m) => m.action)).toEqual(['SUBTITLE_AI_PART', 'SUBTITLE_AI_STORE', 'SUBTITLE_AI_PART']);
        const stored = h.sent[1].track as { cues: unknown[]; site: string; sourceLang: string };
        expect(stored.cues).toHaveLength(10);
        expect(stored.site).toBe('rezka');
        expect(stored.sourceLang).toBe('en');
    });

    test('still unknown after storing: the store was refused (limit), and it stops asking', async () => {
        const h = host([
            () => ({ ok: false, code: 'track_unknown' }),
            () => ({ ok: false, reason: 'refused' }),
            () => ({ ok: false, code: 'track_unknown' }),
        ]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle(); await settle(); await settle();
        expect(h.statuses[h.statuses.length - 1]).toBe('limit');
        expect(h.timers).toHaveLength(0);
    });

    test.each([
        ['auth', { ok: false, code: 'auth' }],
        ['quota', { ok: false, code: 'quota', resetsAt: 1 }],
        ['unavailable', { ok: false, code: 'quarantined' }],
    ])('%s stops it', async (status, reply) => {
        const h = host([() => reply]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        expect(h.statuses[h.statuses.length - 1]).toBe(status);
        expect(h.timers).toHaveLength(0);
    });

    test('temporarily unavailable is asked again later, not in a loop', async () => {
        const h = host([() => ({ ok: false, code: 'unavailable', retryAfterMs: 10000 }), lines]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        expect(h.sent).toHaveLength(1);
        expect(h.timers).toHaveLength(1);
        h.timers.shift()!();
        await settle();
        expect(h.sent).toHaveLength(2);
        expect(h.state.tracks.find((tr) => tr.name === 'Russian · AI')!.subtitles[3].text).toBe('ru 3');
    });

    test('cues the backend would refuse stay empty and do not shift the others', async () => {
        const h = host([lines]);
        const subs = cues(5);
        subs[1] = { startTime: 2, endTime: 2.1, text: 'Too short.' };
        h.state.addTrack('English', subs);
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai.subtitles.map((s) => s.text)).toEqual(['ru 0', '', 'ru 1', 'ru 2', 'ru 3']);
    });

    test('a refused cue with text is marked skipped, so it reads as left out on purpose', () => {
        const h = host([() => new Promise(() => {}) as unknown as Reply]);
        const subs = cues(5);
        subs[1] = { startTime: 2, endTime: 2.1, text: 'Too short.' };
        subs[3] = { startTime: 6, endTime: 7, text: '  ' };
        h.state.addTrack('English', subs);
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai.subtitles.map((s) => !!s.skipped)).toEqual([false, true, false, false, false]);
        expect(ai.subtitles[1].pending).toBeFalsy();
    });

    // A line the server dropped is shown as a dash, the rest of the part as usual.
    test('a line the server skipped reads as left out, not as still coming', async () => {
        const h = host([(m) => ({ ...lines(m), skipped: [3] })]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai.subtitles[3]).toMatchObject({ text: '', skipped: true, pending: false });
        expect(ai.subtitles[2]).toMatchObject({ text: 'ru 2', pending: false });
        expect(ai.subtitles[2].skipped).toBeFalsy();
    });

    test('stop takes the AI track away', async () => {
        const h = host([lines]);
        h.state.addTrack('English', cues(10));
        const t = new AiTranslator(h, 'en', 'ru');
        t.start(h.state.tracks[0]);
        await settle();
        t.stop();
        expect(h.state.tracks.map((tr) => tr.name)).toEqual(['English']);
        expect(h.state.preferredSecondaryName).toBeUndefined();
    });

    test('a language the backend does not take is reported, with no request', () => {
        const h = host([]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'xx', 'ru').start(h.state.tracks[0]);
        expect(h.statuses).toEqual(['unsupported']);
        expect(h.sent).toHaveLength(0);
    });
    // Retry only what passes by itself; otherwise wait for the viewer.
    describe('a part the server cannot translate now', () => {
        const runTimers = async (h: ReturnType<typeof host>, rounds = 6) => {
            for (let i = 0; i < rounds; i++) {
                for (const fn of h.timers.splice(0)) fn();
                await settle();
            }
        };
        const down = (retryAfterMs?: number) => () => ({ ok: false, code: 'unavailable', ...(retryAfterMs ? { retryAfterMs } : {}) });

        test('a Retry-After of 5 s is retried after 5 s, at most 3 times', async () => {
            const h = host([down(5000), down(5000), down(5000), down(5000), lines]);
            h.state.addTrack('English', cues(10));
            new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
            await settle();
            await runTimers(h);
            expect(h.sent).toHaveLength(4); // the first ask and three retries
            expect(h.delays.slice(0, 3)).toEqual([5000, 5000, 5000]);
            expect(h.statuses[h.statuses.length - 1]).toBe('unavailable');
            const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
            expect(ai.subtitles[3].pending).toBeFalsy();
        });

        test.each([
            ['a Retry-After past 60 s', 61_000],
            ['no Retry-After', undefined],
        ])('%s: nothing more is asked until a seek', async (_name, ms) => {
            const h = host([down(ms), lines]);
            h.state.addTrack('English', cues(10));
            const t = new AiTranslator(h, 'en', 'ru');
            t.start(h.state.tracks[0]);
            await settle();
            await runTimers(h);
            expect(h.sent).toHaveLength(1);
            expect(h.statuses[h.statuses.length - 1]).toBe('unavailable');
            t.viewerEvent(); // a seek
            await settle();
            expect(h.sent).toHaveLength(2);
            expect(h.state.tracks.find((tr) => tr.name === 'Russian · AI')!.subtitles[3].text).toBe('ru 3');
        });

        test('a return to Dual asks again', async () => {
            const h = host([down(), lines]);
            h.state.addTrack('English', cues(10));
            const t = new AiTranslator(h, 'en', 'ru');
            t.start(h.state.tracks[0]);
            await settle();
            t.setPaused(true);
            await runTimers(h);
            expect(h.sent).toHaveLength(1);
            t.setPaused(false);
            await settle();
            expect(h.sent).toHaveLength(2);
        });
    });
    // Each refusal reason has its own status and message.
    describe('each refusal reason gets its own status', () => {
        test('a network error while storing the track is not "limit"', async () => {
            const h = host([
                () => ({ ok: false, code: 'track_unknown' }),
                () => ({ ok: false, reason: 'network' }),
                () => ({ ok: false, code: 'track_unknown' }),
            ]);
            h.state.addTrack('English', cues(10));
            new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
            await settle(); await settle(); await settle();
            expect(h.statuses).not.toContain('limit');
            expect(h.statuses[h.statuses.length - 1]).toBe('unavailable');
        });

        test('the per-minute limit says "try in a minute", not "tomorrow"', async () => {
            const h = host([() => ({ ok: false, code: 'rate_limited', retryAfterMs: 60000 })]);
            h.state.addTrack('English', cues(10));
            new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
            await settle();
            expect(h.statuses[h.statuses.length - 1]).toBe('rate');
            expect(h.statuses).not.toContain('quota');
        });

        test('a track too long to store has its own message, not "unavailable"', async () => {
            const h = host([
                () => ({ ok: false, code: 'track_unknown' }),
                () => ({ ok: false, reason: 'too_long' }),
            ]);
            h.state.addTrack('English', cues(10));
            new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
            await settle(); await settle();
            expect(h.statuses[h.statuses.length - 1]).toBe('too_long');
        });
    });
    // A translation that stops on an error says so; the AI track stays.
    test('an error stop shows the error status and keeps the AI track', async () => {
        const h = host([(m) => ({ ...lines(m), lines: null })]);
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle(); await settle();
        expect(h.statuses[h.statuses.length - 1]).toBe('unavailable');
        const ai = h.state.tracks.find((tr) => tr.name === 'Russian · AI')!;
        expect(ai).toBeDefined();
        expect(ai.subtitles.some((c) => c.pending)).toBe(false);
        expect(h.timers).toHaveLength(0);
    });
    // Lines arriving repaint only the lines, never the whole panel.
    test('a part arriving refreshes the lines only, not the whole panel', async () => {
        const h = host([lines]);
        let lineRefreshes = 0;
        h.refreshLines = () => { lineRefreshes++; };
        h.state.addTrack('English', cues(10));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        const full = h.refreshed();
        await settle();
        expect(h.state.tracks.find((tr) => tr.name === 'Russian · AI')!.subtitles[3].text).toBe('ru 3');
        expect(lineRefreshes).toBeGreaterThan(0);
        expect(h.refreshed()).toBe(full);
    });
});
