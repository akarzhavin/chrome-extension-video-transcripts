/**
 * The service-worker half of server-side subtitle translation (english repo,
 * spec 023): asking for translated parts and storing a track in Firestore.
 * Every answer is a value, never a throw: a thrown "Firestore commit 403"
 * would match background.ts' isAuthFailure and sign the learner out.
 */

import { requestPart, storeTrack, type WorkerDeps } from '../src/subtitle-ai/worker';
import type { AuthConfig } from '../src/auth/config';

const cfg = {
    apiBaseUrl: 'https://api.test',
    firestoreUrl: 'https://fs.test',
    projectId: 'proj',
} as AuthConfig;

const FP = 'a'.repeat(64);

// jsdom has no Response; the worker reads only these.
function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
        json: async () => body,
    } as unknown as Response;
}

function deps(answers: Response[]): WorkerDeps & { calls: { url: string; init: RequestInit }[]; refreshed: number } {
    const d = {
        calls: [] as { url: string; init: RequestInit }[],
        refreshed: 0,
        fetch: async (url: string, init: RequestInit) => {
            d.calls.push({ url, init });
            const r = answers.shift();
            if (!r) throw new Error('unexpected fetch');
            return r;
        },
        token: async (refresh: boolean) => {
            if (refresh) d.refreshed++;
            return { idToken: refresh ? 'tok2' : 'tok1', uid: 'u1' };
        },
        now: () => Date.UTC(2026, 9, 9, 12, 0, 0),
    };
    return d;
}

describe('requestPart', () => {
    test('asks the edge with the bearer token for exactly the range', async () => {
        const d = deps([reply(200, { from: 0, to: 2, lines: ['а', 'б'], quota: { used_chars: 2, limit_chars: 10, resets_at: 9 } })]);
        const r = await requestPart(cfg, { fingerprint: FP, lang: 'ru', from: 0, to: 2 }, d);
        expect(r).toEqual({ ok: true, from: 0, to: 2, lines: ['а', 'б'] });
        expect(d.calls[0].url).toBe(`https://api.test/dictionary/subtitles/${FP}/part`);
        expect((d.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok1');
        expect(JSON.parse(d.calls[0].init.body as string)).toEqual({ lang: 'ru', from: 0, to: 2 });
    });

    // The id lands in a URL path: anything but the 64-hex fingerprint is refused before any request.
    test.each(['../write_limits/u1', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '?x=1'])(
        'a malformed track id %s is invalid, with no request', async (fp) => {
            const d = deps([]);
            expect(await requestPart(cfg, { fingerprint: fp, lang: 'ru', from: 0, to: 2 }, d)).toEqual({ ok: false, code: 'invalid' });
            expect(d.calls).toHaveLength(0);
        });

    test('a 401 refreshes the token once and asks again', async () => {
        const d = deps([reply(401, {}), reply(200, { from: 0, to: 1, lines: ['x'], quota: {} })]);
        const r = await requestPart(cfg, { fingerprint: FP, lang: 'ru', from: 0, to: 1 }, d);
        expect(r.ok).toBe(true);
        expect(d.refreshed).toBe(1);
        expect((d.calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok2');
    });

    test.each([
        [404, { code: 'track_unknown' }, {}, { ok: false, code: 'track_unknown' }],
        [403, {}, {}, { ok: false, code: 'auth' }],
        [422, { code: 'invalid_track' }, {}, { ok: false, code: 'invalid' }],
        [429, { code: 'quota_exceeded', resets_at: 77 }, {}, { ok: false, code: 'quota', resetsAt: 77 }],
        [429, { code: 'rate_limited' }, { 'Retry-After': '60' }, { ok: false, code: 'quota', retryAfterMs: 60000 }],
        [503, { code: 'quarantined' }, {}, { ok: false, code: 'quarantined' }],
        [503, { code: 'unavailable' }, { 'Retry-After': '10' }, { ok: false, code: 'unavailable', retryAfterMs: 10000 }],
        [500, {}, {}, { ok: false, code: 'unavailable' }],
    ])('%i %j is %j', async (status, body, headers, want) => {
        const d = deps([reply(status, body, headers)]);
        expect(await requestPart(cfg, { fingerprint: FP, lang: 'ru', from: 0, to: 1 }, d)).toEqual(want);
    });

    test('a network failure is unavailable, not a throw', async () => {
        const d = deps([]);
        d.fetch = async () => { throw new TypeError('Failed to fetch'); };
        expect(await requestPart(cfg, { fingerprint: FP, lang: 'ru', from: 0, to: 1 }, d)).toEqual({ ok: false, code: 'unavailable' });
    });

    test('not signed in is auth, not a throw', async () => {
        const d = deps([]);
        d.token = async () => { throw new Error('Not signed in'); };
        expect(await requestPart(cfg, { fingerprint: FP, lang: 'ru', from: 0, to: 1 }, d)).toEqual({ ok: false, code: 'auth' });
    });
});

const track = {
    fingerprint: FP,
    sourceLang: 'en',
    site: 'rezka',
    durationMs: 3000,
    cues: [{ start_ms: 0, end_ms: 1000, text: 'Hi.' }, { start_ms: 1000, end_ms: 3000, text: 'Bye.' }],
};

describe('storeTrack', () => {
    const limitsDoc = (day: number, count: number) =>
        reply(200, { fields: { day: { integerValue: String(day) }, day_count: { integerValue: String(count) } } });

    test('one commit: the counter advanced and the track created, never overwritten', async () => {
        const d = deps([limitsDoc(20261009, 3), reply(200, {})]);
        expect(await storeTrack(cfg, track, d)).toEqual({ ok: true });

        expect(d.calls[0].url).toBe('https://fs.test/v1/projects/proj/databases/(default)/documents/write_limits/u1');
        const { writes } = JSON.parse(d.calls[1].init.body as string);
        const base = 'projects/proj/databases/(default)/documents';
        expect(writes[0].update.name).toBe(`${base}/write_limits/u1`);
        expect(writes[0].update.fields).toEqual({ day: { integerValue: '20261009' }, day_count: { integerValue: '4' } });
        expect(writes[0].updateTransforms).toEqual([{ fieldPath: 'last_at', setToServerValue: 'REQUEST_TIME' }]);

        expect(writes[1].update.name).toBe(`${base}/subtitle_tracks/${FP}`);
        expect(writes[1].currentDocument).toEqual({ exists: false });
        expect(writes[1].updateTransforms).toEqual([{ fieldPath: 'created_at', setToServerValue: 'REQUEST_TIME' }]);
        const f = writes[1].update.fields;
        expect(Object.keys(f).sort()).toEqual(['cue_count', 'cues', 'duration_ms', 'expire_at', 'site', 'source_lang']);
        expect(f.cue_count).toEqual({ integerValue: '2' });
        expect(f.duration_ms).toEqual({ integerValue: '3000' });
        expect(f.expire_at).toEqual({ timestampValue: new Date(Date.UTC(2026, 9, 23, 12)).toISOString() }); // 14 days (T053)
        expect(f.cues.arrayValue.values[1]).toEqual({
            mapValue: { fields: { start_ms: { integerValue: '1000' }, end_ms: { integerValue: '3000' }, text: { stringValue: 'Bye.' } } },
        });
    });

    test('a new UTC day, or no counter yet, starts the count at one', async () => {
        for (const first of [limitsDoc(20261008, 30), reply(404, {})]) {
            const d = deps([first, reply(200, {})]);
            expect(await storeTrack(cfg, track, d)).toEqual({ ok: true });
            expect(JSON.parse(d.calls[1].init.body as string).writes[0].update.fields.day_count).toEqual({ integerValue: '1' });
        }
    });

    test('a refused commit is a value, not a thrown 403', async () => {
        const d = deps([limitsDoc(20261009, 3), reply(403, { error: { status: 'PERMISSION_DENIED' } })]);
        expect(await storeTrack(cfg, track, d)).toEqual({ ok: false, reason: 'refused' });
    });

    test('over the daily count it does not even try', async () => {
        const d = deps([limitsDoc(20261009, 30)]);
        expect(await storeTrack(cfg, track, d)).toEqual({ ok: false, reason: 'refused' });
        expect(d.calls).toHaveLength(1);
    });

    // The id lands in a Firestore document path: only the 64-hex fingerprint is stored.
    test('a malformed track id is refused, with no request', async () => {
        const d = deps([]);
        expect(await storeTrack(cfg, { ...track, fingerprint: '../write_limits/u2' }, d)).toEqual({ ok: false, reason: 'refused' });
        expect(d.calls).toHaveLength(0);
    });

    test('a track past Firestore\'s 1 MiB document limit is too long, with no request', async () => {
        const big = { ...track, cues: Array.from({ length: 2500 }, (_, i) => ({ start_ms: i * 1000, end_ms: i * 1000 + 999, text: 'я'.repeat(240) })) };
        const d = deps([]);
        expect(await storeTrack(cfg, big, d)).toEqual({ ok: false, reason: 'too_long' });
        expect(d.calls).toHaveLength(0);
    });
});
