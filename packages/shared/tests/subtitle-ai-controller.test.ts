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
    const statuses: AiStatus[] = [];
    let refreshed = 0;
    const h: AiHost & { sent: Reply[]; timers: (() => void)[]; statuses: AiStatus[]; refreshed: () => number; time: number } = {
        state: new AppState(),
        site: 'rezka',
        sent,
        timers,
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
        later: (fn) => { timers.push(fn); },
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
});
