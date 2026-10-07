/**
 * The stats choice, one for both editions (analytics-consent.ts): written here
 * and in the other edition, answered for the other edition, and adopted on a
 * fresh install when the other edition is already opted out.
 */
const store: Record<string, unknown> = {};
const sendMessage = jest.fn();
(global as any).chrome = {
    // The YouTube edition's store id: its sibling is the HDrezka store id.
    runtime: { id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan', sendMessage },
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? {});
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v));
            }),
        },
        onChanged: { addListener: jest.fn() },
    },
};

const track = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/analytics-bg', () => ({ track: (...a: unknown[]) => track(...a) }));

import { adoptAnalyticsOptOut, answerAnalyticsRequest, setAnalyticsEverywhere } from '../src/analytics-consent';

const T = 'lingogram-sibling';
const REZKA = 'hmdkmkimdbomemfcjmgeclchbcdbhabj';
const flag = () => (store['prefs.v1'] as any)?.analyticsEnabled;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    sendMessage.mockReset().mockResolvedValue({ ok: true });
    track.mockClear();
});

describe('a change on the settings page', () => {
    test('is stored here and sent to the other edition', async () => {
        await setAnalyticsEverywhere(false);
        expect(flag()).toBe(false);
        expect(sendMessage).toHaveBeenCalledWith(REZKA, { type: T, op: 'analyticsSet', on: false });
    });

    test('is stored here when the other edition is not installed', async () => {
        sendMessage.mockRejectedValue(new Error('Could not establish connection'));
        await expect(setAnalyticsEverywhere(false)).resolves.toBeUndefined();
        expect(flag()).toBe(false);
    });

    test('reports the opt-out once, before the gate closes', async () => {
        await setAnalyticsEverywhere(false);
        await setAnalyticsEverywhere(false);
        expect(track).toHaveBeenCalledTimes(1);
        expect(track).toHaveBeenCalledWith('analytics_opt_out');
    });

    test('turning it on reports nothing', async () => {
        store['prefs.v1'] = { analyticsEnabled: false };
        await setAnalyticsEverywhere(true);
        expect(flag()).toBe(true);
        expect(track).not.toHaveBeenCalled();
    });
});

describe('answering the other edition', () => {
    test('set: stores the choice', async () => {
        expect(await answerAnalyticsRequest({ type: T, op: 'analyticsSet', on: false })).toEqual({ ok: true });
        expect(flag()).toBe(false);
        expect(track).toHaveBeenCalledWith('analytics_opt_out');
    });

    test('set: refuses a value that is not a boolean, and writes nothing', async () => {
        const r = await answerAnalyticsRequest({ type: T, op: 'analyticsSet', on: 'no' });
        expect(r?.ok).toBe(false);
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('get: this edition’s choice', async () => {
        store['prefs.v1'] = { analyticsEnabled: false };
        expect(await answerAnalyticsRequest({ type: T, op: 'analyticsGet' })).toEqual({ ok: true, on: false });
    });

    test('leaves other messages to other listeners', async () => {
        expect(await answerAnalyticsRequest({ type: T, op: 'status' })).toBeNull();
        expect(await answerAnalyticsRequest({ type: 'other', op: 'analyticsGet' })).toBeNull();
    });
});

describe('a fresh install', () => {
    test('is opted out when the other edition is', async () => {
        sendMessage.mockResolvedValue({ ok: true, on: false });
        await adoptAnalyticsOptOut();
        expect(sendMessage).toHaveBeenCalledWith(REZKA, { type: T, op: 'analyticsGet' });
        expect(flag()).toBe(false);
    });

    test.each([
        ['on', { ok: true, on: true }],
        ['too old to answer', { ok: false, error: 'unknown op' }],
    ])('keeps the default when the other edition is %s', async (_, reply) => {
        sendMessage.mockResolvedValue(reply);
        await adoptAnalyticsOptOut();
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('keeps the default when the other edition is not installed', async () => {
        sendMessage.mockRejectedValue(new Error('Could not establish connection'));
        await adoptAnalyticsOptOut();
        expect(store['prefs.v1']).toBeUndefined();
    });
});
