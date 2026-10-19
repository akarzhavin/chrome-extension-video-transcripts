/**
 * The AI translation names a second subtitle track in a gendered language
 * with every part request; the server genders "I" and "you" from it and
 * answers second_unknown until the track is stored (T113, english repo).
 */

import { AppState } from '../src/AppState';
import { AiTranslator, type AiHost } from '../src/subtitle-ai/controller';
import type { SecondCandidate } from '../src/subtitle-ai/second';
import { requestPart, type WorkerDeps } from '../src/subtitle-ai/worker';
import type { AuthConfig } from '../src/auth/config';
import type { Subtitle } from '../src/types';

const cues = (n: number, word = 'Line'): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `${word} ${i}.` }));

type Reply = Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
    for (let k = 0; k < 12; k++) await tick();
};

function host(replies: ((msg: Reply) => Reply)[], candidates?: SecondCandidate[]) {
    const sent: Reply[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    let listed = 0;
    const h: AiHost & { sent: Reply[]; timers: typeof timers; listed: () => number } = {
        state: new AppState(),
        site: 'youtube',
        sent,
        timers,
        listed: () => listed,
        refresh: () => {},
        currentTime: () => 0,
        now: () => 1_000_000,
        send: async (msg: object) => {
            sent.push(msg as Reply);
            await tick(); // a reply takes a network round trip; the pick is local
            const next = replies.shift();
            if (!next) throw new Error(`unexpected message ${JSON.stringify(msg).slice(0, 80)}`);
            return next(msg as Reply);
        },
        later: (fn, ms) => { timers.push({ fn, ms }); },
        ...(candidates ? { secondTracks: () => { listed++; return candidates; } } : {}),
    };
    h.state.setLanguagePreferences('English', 'Russian');
    return h;
}

const lines = (m: Reply) => {
    const p = m.part as { from: number; to: number };
    return { ok: true, from: p.from, to: p.to, lines: Array.from({ length: p.to - p.from }, (_, k) => `ru ${p.from + k}`), skipped: [], pending: [] };
};
const unknownSecond = (m: Reply) => ({ ...lines(m), secondUnknown: true });
const spanish: SecondCandidate = { lang: 'es', kind: 'manual', load: async () => cues(120, 'Línea') };
const secondOf = (m: Reply) => (m.part as { second?: string }).second;
const actions = (h: { sent: Reply[] }) => h.sent.map((m) => (m.action === 'SUBTITLE_AI_STORE' ? `store:${(m.track as { sourceLang: string }).sourceLang}` : `part:${secondOf(m) ? 'second' : '-'}`));

describe('the second track', () => {
    test('once picked, every part names it; second_unknown stores it, and the next parts still name it', async () => {
        const h = host([lines, unknownSecond, () => ({ ok: true }), lines, lines], [spanish]);
        h.state.addTrack('English', cues(120));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        expect(actions(h).slice(0, 3)).toEqual(['part:-', 'part:second', 'store:es']);
        expect(secondOf(h.sent[1])).toMatch(/^[0-9a-f]{64}$/);
        const stored = h.sent[2].track as { fingerprint: string; cues: unknown[]; site: string };
        expect(stored.fingerprint).toBe(secondOf(h.sent[1]));
        expect(stored.cues).toHaveLength(120);
        expect(stored.site).toBe('youtube');
    });

    test('right after the learning track was stored, the second waits out the store interval', async () => {
        let stored = 0;
        const h = host([]);
        h.secondTracks = () => [spanish];
        h.send = async (msg: object) => {
            const m = msg as Reply;
            h.sent.push(m);
            await tick();
            if (m.action === 'SUBTITLE_AI_STORE') { stored++; return { ok: true }; }
            if (stored === 0) return { ok: false, code: 'track_unknown' };
            return secondOf(m) && stored === 1 ? unknownSecond(m) : lines(m);
        };
        h.state.addTrack('English', cues(120));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        expect(actions(h)).toContain('part:second');
        expect(actions(h)).not.toContain('store:es');
        const wait = h.timers.find((t) => t.ms >= 20_000);
        expect(wait?.ms).toBe(21_000);
        wait!.fn();
        await settle();
        expect(actions(h)).toContain('store:es');
    });

    test('still unknown after it was stored: it is no longer named', async () => {
        const h = host([]);
        h.secondTracks = () => [spanish];
        let parts = 0;
        h.send = async (msg: object) => {
            const m = msg as Reply;
            h.sent.push(m);
            await tick();
            if (m.action === 'SUBTITLE_AI_STORE') return { ok: false, reason: 'refused' };
            parts++;
            if (parts === 1 || parts === 4) return lines(m);
            const p = m.part as { from: number; to: number };
            const all = Array.from({ length: p.to - p.from }, (_, k) => p.from + k);
            return { ...lines(m), pending: all, secondUnknown: true };
        };
        h.state.addTrack('English', cues(120));
        const t = new AiTranslator(h, 'en', 'ru');
        t.start(h.state.tracks[0]);
        await settle();
        t.viewerEvent();
        await settle();
        t.viewerEvent();
        await settle();
        expect(actions(h)).toEqual(['part:-', 'part:second', 'store:es', 'part:second', 'part:-']);
    });

    test('a target that shows no gender of "I" and "you" never looks for one', async () => {
        const h = host([lines, lines], [spanish]);
        h.state.setLanguagePreferences('English', 'Chinese');
        h.state.addTrack('English', cues(120));
        new AiTranslator(h, 'en', 'zh').start(h.state.tracks[0]);
        await settle();
        expect(h.listed()).toBe(0);
        expect(h.sent.map(secondOf)).toEqual([undefined, undefined]);
    });
});

describe('the hint gate (spec 032)', () => {
    test('not allowed: no second track is looked for, and no part names one', async () => {
        const h = host([lines, lines], [spanish]);
        h.hintAllowed = async () => false;
        h.state.addTrack('English', cues(120));
        new AiTranslator(h, 'en', 'ru').start(h.state.tracks[0]);
        await settle();
        expect(h.listed()).toBe(0);
        expect(actions(h)).toEqual(['part:-', 'part:-']);
    });

    test('allowed only later: looked for then, and named from the next part', async () => {
        let allowed = false;
        let at = 0;
        const h = host([lines, lines, lines, lines], [spanish]);
        h.hintAllowed = async () => allowed;
        h.currentTime = () => at;
        h.state.addTrack('English', cues(120));
        const t = new AiTranslator(h, 'en', 'ru');
        t.start(h.state.tracks[0]);
        await settle();
        expect(h.listed()).toBe(0);
        allowed = true;
        at = 120; // a seek further on: new parts to ask for
        t.viewerEvent();
        await settle();
        expect(h.listed()).toBe(1);
        expect(actions(h)).toEqual(['part:-', 'part:-', 'part:-', 'part:second']);
    });

    test('closed mid-video: the picked track is no longer named', async () => {
        let allowed = true;
        let at = 0;
        const h = host([lines, lines, lines, lines], [spanish]);
        h.hintAllowed = async () => allowed;
        h.currentTime = () => at;
        h.state.addTrack('English', cues(120));
        const t = new AiTranslator(h, 'en', 'ru');
        t.start(h.state.tracks[0]);
        await settle();
        expect(actions(h)).toEqual(['part:-', 'part:second']);
        allowed = false;
        at = 120;
        t.viewerEvent();
        await settle();
        expect(actions(h).slice(2)).toEqual(['part:-', 'part:-']);
    });
});

describe('requestPart', () => {
    const cfg = { apiBaseUrl: 'https://api.test' } as AuthConfig;
    const deps = (body: unknown): WorkerDeps & { bodies: unknown[] } => {
        const bodies: unknown[] = [];
        return {
            bodies,
            fetch: async (_url: string, init: RequestInit) => {
                bodies.push(JSON.parse(init.body as string));
                return { status: 200, ok: true, headers: { get: () => null }, json: async () => body } as unknown as Response;
            },
            token: async () => ({ idToken: 't', uid: 'u' }),
            now: () => 0,
        };
    };

    test('names the second track and passes on second_unknown', async () => {
        const d = deps({ from: 0, to: 1, lines: ['а'], skipped: [], pending: [], second_unknown: true });
        const r = await requestPart(cfg, { fingerprint: 'a'.repeat(64), lang: 'ru', from: 0, to: 1, second: 'b'.repeat(64) }, d);
        expect(d.bodies[0]).toEqual({ lang: 'ru', from: 0, to: 1, second: 'b'.repeat(64) });
        expect(r).toMatchObject({ ok: true, secondUnknown: true });
    });

    test('a second id that is not a fingerprint is not sent', async () => {
        const d = deps({ from: 0, to: 1, lines: ['а'], skipped: [], pending: [] });
        await requestPart(cfg, { fingerprint: 'a'.repeat(64), lang: 'ru', from: 0, to: 1, second: '../x' }, d);
        expect(d.bodies[0]).toEqual({ lang: 'ru', from: 0, to: 1 });
    });
});
