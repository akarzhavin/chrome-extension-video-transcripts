/**
 * The highlight settings answer from the edition that paints (highlight-prefs.ts):
 * what it tells the other edition, and what it refuses to write.
 */
const store: Record<string, unknown> = {};
const sendMessage = jest.fn();
(global as any).chrome = {
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

import { answerHighlightRequest, takeHighlightPrefsFrom } from '../src/highlight-prefs';

const T = 'lingogram-sibling';
const prefs = () => store['prefs.v1'] as any;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    sendMessage.mockReset();
});

describe('answering the other edition', () => {
    test('get: this edition’s highlight settings', async () => {
        store['prefs.v1'] = { pageHighlight: false, highlightOffHosts: ['a.com'] };
        expect(await answerHighlightRequest({ type: T, op: 'highlightGet' })).toEqual({
            ok: true,
            prefs: { pageHighlight: false, highlightOffHosts: ['a.com'] },
        });
    });

    test('set: applies the switch and one website against the list as it is now', async () => {
        store['prefs.v1'] = { pageHighlight: true, highlightOffHosts: ['a.com', 'b.com'] };
        const r = await answerHighlightRequest({ type: T, op: 'highlightSet', change: { pageHighlight: false, highlightHost: { host: 'a.com', on: true } } });
        expect(r).toEqual({ ok: true });
        expect(prefs().pageHighlight).toBe(false);
        expect(prefs().highlightOffHosts).toEqual(['b.com']);
    });

    test.each([
        [undefined],
        [{ pageHighlight: 'no' }],
        [{ highlightHost: { host: 'a b', on: true } }],
        [{ highlightHost: { host: 'a.com' } }],
    ])('refuses %p and writes nothing', async (change) => {
        store['prefs.v1'] = { pageHighlight: true };
        const r = await answerHighlightRequest({ type: T, op: 'highlightSet', change });
        expect(r?.ok).toBe(false);
        expect(store['prefs.v1']).toEqual({ pageHighlight: true });
    });

    test('leaves other messages to other listeners', async () => {
        expect(await answerHighlightRequest({ type: T, op: 'status' })).toBeNull();
        expect(await answerHighlightRequest({ type: 'other', op: 'highlightGet' })).toBeNull();
    });
});

describe('taking the settings over', () => {
    test('copies the previous owner’s settings', async () => {
        store['prefs.v1'] = { pageHighlight: true, highlightOffHosts: [] };
        sendMessage.mockResolvedValue({ ok: true, prefs: { pageHighlight: false, highlightOffHosts: ['x.com'] } });
        await takeHighlightPrefsFrom('hmdkmkimdbomemfcjmgeclchbcdbhabj');
        expect(sendMessage).toHaveBeenCalledWith('hmdkmkimdbomemfcjmgeclchbcdbhabj', { type: T, op: 'highlightGet' });
        expect([prefs().pageHighlight, prefs().highlightOffHosts]).toEqual([false, ['x.com']]);
    });

    test('keeps its own when the previous owner is gone or answers nonsense', async () => {
        store['prefs.v1'] = { pageHighlight: true, highlightOffHosts: ['mine.com'] };
        sendMessage.mockRejectedValueOnce(new Error('gone'));
        await takeHighlightPrefsFrom('x');
        sendMessage.mockResolvedValueOnce({ ok: true, prefs: { pageHighlight: 'yes' } });
        await takeHighlightPrefsFrom('x');
        expect(store['prefs.v1']).toEqual({ pageHighlight: true, highlightOffHosts: ['mine.com'] });
    });
});
