/**
 * The guest check (english repo spec 034): signed out, which features the
 * server shows this installation, asked without a token and kept in the 032
 * features store marked as a guest's answer.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn(async (k: string | string[]) => {
                const out: Record<string, unknown> = {};
                for (const key of Array.isArray(k) ? k : [k]) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (o: Record<string, unknown>) => {
                Object.assign(store, o);
            }),
            remove: jest.fn(async (k: string | string[]) => {
                for (const key of Array.isArray(k) ? k : [k]) delete store[key];
            }),
        },
    },
};

import { forgetFeatures } from '../src/features/store';
import { refreshGuestFeatures } from '../src/installation/guest';

const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const reply = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

test('asks the guest route for this installation, without a token, and keeps the answer as a guest one', async () => {
    const fetch = jest.fn(async () => reply(200, { features: { ai: true } }));
    const got = await refreshGuestFeatures('https://api.test/', { fetch, id: async () => ID, now: () => NOW });
    expect(got).toEqual({ ai: true });
    expect(fetch).toHaveBeenCalledWith(`https://api.test/dictionary/guest/features?installation=${ID}`, { method: 'GET' });
    expect(store.features).toEqual({ features: { ai: true }, at: NOW, as: 'guest' });
});

test('a failed or malformed answer keeps nothing new; the last answer stands', async () => {
    store.features = { features: { ai: true }, at: 1, as: 'guest' };
    for (const fetch of [
        async () => reply(503, {}),
        async () => reply(200, { nope: 1 }),
        async () => {
            throw new Error('offline');
        },
    ]) {
        expect(await refreshGuestFeatures('https://api.test', { fetch, id: async () => ID, now: () => NOW })).toBeNull();
    }
    expect(store.features).toEqual({ features: { ai: true }, at: 1, as: 'guest' });
});

test('no ID, or no API, asks nothing', async () => {
    const fetch = jest.fn();
    expect(await refreshGuestFeatures('https://api.test', { fetch, id: async () => null })).toBeNull();
    expect(await refreshGuestFeatures('', { fetch, id: async () => ID })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
});

test('an answer that lands after a sign-in is not kept', async () => {
    let release: (r: Response) => void = () => undefined;
    const ask = refreshGuestFeatures('https://api.test', {
        fetch: () => new Promise<Response>((r) => (release = r)),
        id: async () => ID,
        now: () => NOW,
    });
    await new Promise((r) => setTimeout(r, 0));
    await forgetFeatures(); // what a sign-in does to the store
    release(reply(200, { features: { ai: true } }));
    expect(await ask).toBeNull();
    expect(store.features).toBeUndefined();
});
