/**
 * The AI translation switch, one for both editions (subtitle-ai/sync.ts), the
 * way analytics-consent.test.ts checks the stats choice.
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

import { adoptAiTranslate, answerAiTranslateRequest, setAiTranslateEverywhere } from '../src/subtitle-ai/sync';

const T = 'lingogram-sibling';
const REZKA = 'hmdkmkimdbomemfcjmgeclchbcdbhabj';
const flag = () => (store['prefs.v1'] as any)?.aiTranslate;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    sendMessage.mockReset().mockResolvedValue({ ok: true });
});

describe('a change on the settings page', () => {
    test('is stored here and sent to the other edition', async () => {
        await setAiTranslateEverywhere(true);
        expect(flag()).toBe(true);
        expect(sendMessage).toHaveBeenCalledWith(REZKA, { type: T, op: 'aiTranslateSet', on: true });
    });

    test('is stored here when the other edition is not installed', async () => {
        sendMessage.mockRejectedValue(new Error('Could not establish connection'));
        await expect(setAiTranslateEverywhere(true)).resolves.toBeUndefined();
        expect(flag()).toBe(true);
    });
});

describe('answering the other edition', () => {
    test('set: stores the switch', async () => {
        expect(await answerAiTranslateRequest({ type: T, op: 'aiTranslateSet', on: true })).toEqual({ ok: true });
        expect(flag()).toBe(true);
    });

    test('set: refuses a value that is not a boolean, and writes nothing', async () => {
        const r = await answerAiTranslateRequest({ type: T, op: 'aiTranslateSet', on: 'yes' });
        expect(r?.ok).toBe(false);
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('get: this edition’s switch', async () => {
        store['prefs.v1'] = { aiTranslate: true };
        expect(await answerAiTranslateRequest({ type: T, op: 'aiTranslateGet' })).toEqual({ ok: true, on: true });
    });

    test('leaves other messages to other listeners', async () => {
        expect(await answerAiTranslateRequest({ type: T, op: 'analyticsGet' })).toBeNull();
        expect(await answerAiTranslateRequest({ type: 'other', op: 'aiTranslateGet' })).toBeNull();
    });
});

describe('a fresh install', () => {
    test('is on when the other edition has it on', async () => {
        sendMessage.mockResolvedValue({ ok: true, on: true });
        await adoptAiTranslate();
        expect(sendMessage).toHaveBeenCalledWith(REZKA, { type: T, op: 'aiTranslateGet' });
        expect(flag()).toBe(true);
    });

    test.each([
        ['off', { ok: true, on: false }],
        ['too old to answer', { ok: false, error: 'unknown op' }],
    ])('keeps the default when the other edition is %s', async (_, reply) => {
        sendMessage.mockResolvedValue(reply);
        await adoptAiTranslate();
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('keeps the default when the other edition is not installed', async () => {
        sendMessage.mockRejectedValue(new Error('Could not establish connection'));
        await adoptAiTranslate();
        expect(store['prefs.v1']).toBeUndefined();
    });
});
