/**
 * @jest-environment jsdom
 *
 * Word-save diagnostics, end to end (specs/save-diagnostics).
 *
 * A save that failed live — `Firestore rules 403`, then "sign in" on the next
 * press — left nothing behind to explain it. These drive the real path: the
 * content script's saveTerm / removeTerm, through the real worker listener
 * (installAuthMessageHandler), into the real firestoreRest against a fetch
 * stub, and read back what the save log kept. Only the network is fake.
 */

const store: Record<string, unknown> = {};
const area = {
    get: jest.fn((keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        return Promise.resolve(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]])));
    }),
    set: jest.fn((o: Record<string, unknown>) => {
        Object.assign(store, JSON.parse(JSON.stringify(o)));
        return Promise.resolve();
    }),
    remove: jest.fn((keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        return Promise.resolve();
    }),
};

let listener: ((m: unknown, s: unknown, reply: (r: unknown) => void) => boolean) | null = null;
const sent: Array<Record<string, unknown>> = [];
let manifest: Record<string, unknown> = { version: '9.9.9' };

(global as any).chrome = {
    runtime: {
        id: 'dev-copy-id',
        lastError: undefined,
        getManifest: () => manifest,
        onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
        // Routed into the worker's real listener, as Chrome would.
        sendMessage: jest.fn((m: Record<string, unknown>, cb: (r: unknown) => void) => {
            sent.push(m);
            listener!(m, {}, cb);
        }),
    },
    storage: { local: area, session: area, onChanged: { addListener: jest.fn(), removeListener: jest.fn() } },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: jest.fn(() => '') },
    tabs: { create: jest.fn() },
};

jest.mock('../src/analytics-bg', () => ({
    track: jest.fn().mockResolvedValue(undefined),
    handleTrackMessage: jest.fn().mockResolvedValue({ ok: true }),
}));

import { installAuthMessageHandler } from '../src/auth/background';
import { setAuthState } from '../src/auth/storage';
import { removeTerm, saveTerm } from '../src/content/quick-add-overlay';
import { SAVE_LOG_KEY, type SaveLogData } from '../src/debug/save-log';

installAuthMessageHandler();

/** A fetch answer with the clone() the collector reads error bodies through. */
function answer(status: number, body: unknown = {}): Response {
    const text = JSON.stringify(body);
    const r = {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        json: async () => body,
        text: async () => text,
        clone: () => r,
    };
    return r as unknown as Response;
}

const DENIED = { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } };

/** Per-URL answers; each call to `commit` takes the next one. */
let commitAnswers: Response[];
let sentinelAnswer: Response;
let refreshAnswer: Response;

// The log is written fire-and-forget after the press resolves (a save must not
// wait on its own diagnostics); let that write land before reading it.
const settle = () => new Promise((r) => setTimeout(r, 0));
const save = async (term: string, ctx: string) => {
    const r = await saveTerm(term, ctx);
    await settle();
    return r;
};
const remove = async (term: string) => {
    const r = await removeTerm(term);
    await settle();
    return r;
};

const log = (): SaveLogData => store[SAVE_LOG_KEY] as SaveLogData;
const last = () => log().recent[log().recent.length - 1];

const signIn = () =>
    setAuthState({
        idToken: 'ID-TOKEN-SECRET',
        refreshToken: 'REFRESH-TOKEN-SECRET',
        expiresAt: Date.now() + 3_600_000,
        email: 'reader@example.com',
        uid: 'user-abcdef123456',
    });

beforeEach(async () => {
    for (const k of Object.keys(store)) delete store[k];
    sent.length = 0;
    manifest = { version: '9.9.9' };
    document.body.innerHTML = '';
    commitAnswers = [];
    sentinelAnswer = answer(200, {
        fields: {
            dailyCount: { integerValue: '4' },
            dayBucket: { integerValue: '20260926' },
            lastAddedAt: { timestampValue: '2026-09-26T10:00:00.123Z' },
        },
    });
    refreshAnswer = answer(200, {
        id_token: 'NEW-ID-TOKEN-SECRET',
        refresh_token: 'NEW-REFRESH-SECRET',
        expires_in: '3600',
        user_id: 'user-abcdef123456',
    });
    (global as any).fetch = jest.fn(async (url: string) => {
        if (String(url).includes('/v1/token')) return refreshAnswer;
        if (String(url).includes(':commit')) return commitAnswers.shift() ?? answer(200, { writeResults: [{}] });
        return sentinelAnswer;
    });
    await signIn();
});

describe('a refused save leaves the whole story', () => {
    test('two saves inside a second: the refusal, its spacing, and the sentinel it hit', async () => {
        expect(await save('precinct', 'ctx')).toBe(true);
        // The second press: create form refused, re-activation refused — the
        // shape a one-second-floor refusal takes over the wire.
        commitAnswers = [answer(403, DENIED), answer(403, DENIED)];
        expect(await save('payroll', 'ctx')).toBe(false);

        const a = last();
        expect(a.op).toBe('save');
        expect(a.term).toBe('payroll');
        expect(a.outcome).toBe('failed');
        expect(a.error).toMatch(/^Firestore rules 403/);
        expect(a.shown).toMatch(/^Couldn't save: Firestore rules 403/);
        expect(a.sincePrevMs).not.toBeNull();
        expect(a.sincePrevMs!).toBeLessThan(1000);
        expect(a.worker?.session).toBe(true);
        expect(a.worker?.uidTail).toBe('123456');
        expect(a.worker?.requests.map((r) => [r.kind, r.status, r.errorStatus])).toEqual([
            ['sentinel', 200, undefined],
            ['commit', 403, 'PERMISSION_DENIED'],
            ['commit-reactivate', 403, 'PERMISSION_DENIED'],
        ]);
        expect(a.worker?.sentinel).toEqual({
            exists: true,
            dailyCount: 4,
            dayBucket: 20260926,
            lastAddedAt: '2026-09-26T10:00:00.123Z',
        });
        // Kept apart from the rolling window, with the press before it.
        expect(log().failures).toHaveLength(1);
        expect(log().failures[0].attempt.term).toBe('payroll');
        expect(log().failures[0].before.map((b) => b.term)).toEqual(['precinct']);
    });

    test('a signed-out press records that there was no session, and what was shown', async () => {
        delete store['auth.idToken'];
        delete store['auth.refreshToken'];
        delete store['auth.uid'];
        delete store['auth.expiresAt'];
        delete store['auth.email'];

        expect(await save('precinct', 'ctx')).toBe(false);

        const a = last();
        expect(a.outcome).toBe('failed');
        expect(a.worker?.session).toBe(false);
        expect(a.worker?.requests).toEqual([]);
        expect(a.shown).toBe('Sign in via the Lingogram row above the subtitle list to save words.');
    });

    test('an expired token is refreshed, and the refresh is on the record', async () => {
        commitAnswers = [answer(401, { error: { status: 'UNAUTHENTICATED' } })];

        expect(await save('precinct', 'ctx')).toBe(true);

        const w = last().worker!;
        expect(w.tokenRefreshed).toBe(true);
        expect(w.requests.map((r) => [r.kind, r.status])).toEqual([
            ['sentinel', 200],
            ['commit', 401],
            ['token-refresh', 200],
            ['commit-refreshed', 200],
        ]);
    });
});

describe('what identifies the copy', () => {
    test('an unpacked copy owning its own panel', async () => {
        document.body.innerHTML = '<div id="vtt-sidebar" data-vtt-owner="dev-copy-id"></div>';

        await save('precinct', 'ctx');

        expect(last().copy).toEqual({ id: 'dev-copy-id', version: '9.9.9', install: 'unpacked' });
        expect(last().panelOwner).toBe('dev-copy-id');
    });

    test('a store copy next to another copy that owns the panel', async () => {
        manifest = { version: '1.0.22', update_url: 'https://clients2.google.com/service/update2/crx' };
        document.body.innerHTML = '<div id="vtt-sidebar" data-vtt-owner="store-copy-id"></div>';

        await save('precinct', 'ctx');

        expect(last().copy.install).toBe('store');
        expect(last().panelOwner).toBe('store-copy-id');
        expect(last().panelOwner).not.toBe(last().copy.id);
    });
});

describe('removals are recorded the same way', () => {
    test('a removal refused as "already not saved" is a success, and says so', async () => {
        commitAnswers = [answer(403, DENIED)];

        expect(await remove('precinct')).toBe(true);

        const a = last();
        expect(a.op).toBe('remove');
        expect(a.outcome).toBe('ok');
        expect(a.worker?.refusalTreatedAsSuccess).toBe(true);
        expect(a.worker?.requests.map((r) => [r.kind, r.status])).toEqual([['commit', 403]]);
    });
});

describe('what the log must never hold', () => {
    test('no token and no Authorization header, on any path', async () => {
        await save('precinct', 'ctx');
        commitAnswers = [answer(401, {})];
        await save('payroll', 'ctx');
        commitAnswers = [answer(403, DENIED), answer(403, DENIED)];
        await save('wired', 'ctx');

        const text = JSON.stringify(store[SAVE_LOG_KEY]);
        expect(log().recent).toHaveLength(3);
        for (const secret of ['ID-TOKEN-SECRET', 'REFRESH-TOKEN-SECRET', 'NEW-REFRESH-SECRET', 'Bearer']) {
            expect(text).not.toContain(secret);
        }
    });
});

describe('the switch', () => {
    test('off: the worker is not asked and nothing is written', async () => {
        store['prefs.v1'] = { debugMode: false };
        commitAnswers = [answer(403, DENIED), answer(403, DENIED)];

        await save('precinct', 'ctx');

        const addWord = sent.find((m) => m.action === 'ADD_WORD')!;
        expect(addWord).toBeDefined();
        expect('diag' in addWord).toBe(false);
        expect(store[SAVE_LOG_KEY]).toBeUndefined();
    });

    test('on: the worker is asked', async () => {
        store['prefs.v1'] = { debugMode: true };

        await save('precinct', 'ctx');

        expect(sent.find((m) => m.action === 'ADD_WORD')?.diag).toBe(true);
        expect(log().recent).toHaveLength(1);
    });
});
