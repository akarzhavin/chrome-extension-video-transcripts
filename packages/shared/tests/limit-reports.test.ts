/**
 * Refusal reports (english repo spec 032): the rules refuse a write without the
 * server knowing, so the worker tells it — combined, at most once a minute,
 * never in the way of what the learner did.
 */

import { createRefusalReports, wordRefusal, type RefusalQueue, type ReportDeps } from '../src/limit-reports';

function reply(status: number): Response {
    return { status, ok: status >= 200 && status < 300 } as unknown as Response;
}

const START = Date.UTC(2026, 9, 18, 12, 0, 0);

function deps(answers: (Response | Error)[]) {
    const d = {
        t: START,
        calls: [] as { url: string; init: RequestInit }[],
        saved: undefined as RefusalQueue | undefined,
        timers: [] as { at: number; fn: () => void }[],
        refreshed: 0,
        apiBaseUrl: 'https://api.test',
        version: '1.0.26',
        now: () => d.t,
        fetch: async (url: string, init: RequestInit) => {
            d.calls.push({ url, init });
            const r = answers.shift();
            if (!r) throw new Error('unexpected fetch');
            if (r instanceof Error) throw r;
            return r;
        },
        token: async (refresh: boolean) => {
            if (refresh) d.refreshed++;
            return { idToken: refresh ? 'tok2' : 'tok1' };
        },
        store: {
            load: async () => d.saved,
            save: async (q: RefusalQueue) => {
                d.saved = JSON.parse(JSON.stringify(q));
            },
        },
        schedule: (ms: number, fn: () => void) => {
            d.timers.push({ at: d.t + ms, fn });
        },
    };
    return d satisfies ReportDeps & Record<string, unknown>;
}

const sent = (d: ReturnType<typeof deps>, i = 0) => JSON.parse(d.calls[i].init.body as string);

describe('refusal reports', () => {
    test('the first refusal goes at once, with the bearer token and no content', async () => {
        const d = deps([reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('MAX_WORDS_PER_DAY');
        expect(d.calls[0].url).toBe('https://api.test/dictionary/limits/refusals');
        expect((d.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok1');
        expect(sent(d)).toEqual({ version: '1.0.26', items: [{ limit: 'MAX_WORDS_PER_DAY', count: 1 }] });
        expect(d.saved?.items).toEqual({});
    });

    test('refusals within the minute are combined into one report', async () => {
        const d = deps([reply(204), reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('MAX_WORDS_PER_DAY');
        d.t += 10_000;
        for (let i = 0; i < 11; i++) await r.refused('MAX_WORDS_PER_DAY');
        await r.refused('rules:words');
        expect(d.calls).toHaveLength(1);
        expect(d.timers).toHaveLength(1);
        d.t = d.timers[0].at;
        d.timers[0].fn();
        await r.idle();
        expect(d.calls).toHaveLength(2);
        expect(sent(d, 1).items).toEqual([
            { limit: 'MAX_WORDS_PER_DAY', count: 11 },
            { limit: 'rules:words', count: 1 },
        ]);
    });

    test('a busy server or no network keeps the queue for later', async () => {
        const d = deps([reply(429), new Error('offline'), reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('SUBTITLE_WRITES_PER_DAY');
        d.t += 61_000;
        await r.refused('SUBTITLE_WRITES_PER_DAY');
        d.t += 61_000;
        await r.flush();
        expect(sent(d, 2).items).toEqual([{ limit: 'SUBTITLE_WRITES_PER_DAY', count: 2 }]);
        expect(d.saved?.items).toEqual({});
    });

    test('a report the server refuses is dropped, not retried forever', async () => {
        const d = deps([reply(400)]);
        const r = createRefusalReports(d);
        await r.refused('SUBTITLE_LANGS');
        expect(d.saved?.items).toEqual({});
    });

    test('an expired token is refreshed once', async () => {
        const d = deps([reply(401), reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('MAX_TERM_BYTES');
        expect(d.refreshed).toBe(1);
        expect((d.calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok2');
    });

    test('refusals older than a day are dropped unsent', async () => {
        const d = deps([reply(429), reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('rules:tracks');
        d.t += 25 * 3_600_000;
        await r.refused('rules:feedback');
        expect(sent(d, 1).items).toEqual([{ limit: 'rules:feedback', count: 1 }]);
    });

    test('a count over a hundred goes in parts', async () => {
        const d = deps([reply(429), reply(204)]);
        const r = createRefusalReports(d);
        await r.refused('MAX_WORDS_PER_DAY');
        for (let i = 0; i < 149; i++) await r.refused('MAX_WORDS_PER_DAY');
        d.t += 61_000;
        await r.flush();
        expect(sent(d, 1).items).toEqual([{ limit: 'MAX_WORDS_PER_DAY', count: 100 }]);
        expect(d.saved?.items.MAX_WORDS_PER_DAY?.count).toBe(50);
    });

    test('not signed in: kept, nothing thrown', async () => {
        const d = deps([]);
        d.token = async () => {
            throw new Error('Not signed in');
        };
        const r = createRefusalReports(d);
        await expect(r.refused('MAX_WORDS_PER_DAY')).resolves.toBeUndefined();
        expect(d.saved?.items.MAX_WORDS_PER_DAY?.count).toBe(1);
    });

    test('no backend configured: nothing is sent', async () => {
        const d = deps([]);
        d.apiBaseUrl = '';
        await createRefusalReports(d).refused('MAX_WORDS_PER_DAY');
        expect(d.calls).toHaveLength(0);
    });
});

describe('wordRefusal', () => {
    test.each([
        ['Daily limit of 500 words reached. Try again tomorrow.', 'MAX_WORDS_PER_DAY'],
        ['term must be 1..256 bytes (UTF-8)', 'MAX_TERM_BYTES'],
        ['Firestore rules 403: denied', 'rules:words'],
        ['Firestore commit 500: boom', null],
        ['Not signed in', null],
    ])('%s → %s', (message, want) => {
        expect(wordRefusal(new Error(message))).toBe(want);
    });
});
