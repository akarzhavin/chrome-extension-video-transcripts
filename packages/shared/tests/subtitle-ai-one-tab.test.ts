/**
 * AI translation runs in one tab at a time: the worker keeps the owner and
 * tells the previous one to pause.
 */

const session: Record<string, unknown> = {};
const sentTo: { tab: number; msg: unknown }[] = [];
(global as any).chrome = {
    storage: {
        session: {
            get: jest.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
            set: jest.fn(async (items: Record<string, unknown>) => { Object.assign(session, items); }),
            remove: jest.fn(async (key: string) => { delete session[key]; }),
        },
    },
    tabs: {
        sendMessage: jest.fn(async (tab: number, msg: unknown) => { sentTo.push({ tab, msg }); }),
    },
};

import { claim, release, YIELD } from '../src/subtitle-ai/one-tab';

beforeEach(() => {
    for (const k of Object.keys(session)) delete session[k];
    sentTo.length = 0;
});

test('a claim from another tab pauses the one before it', async () => {
    await claim(1);
    expect(sentTo).toEqual([]);
    await claim(2);
    expect(sentTo).toEqual([{ tab: 1, msg: { action: YIELD } }]);
    await claim(2);
    expect(sentTo).toHaveLength(1);
});

test('two claims at once leave one owner, and the other is told to pause', async () => {
    await claim(1);
    await Promise.all([claim(2), claim(3)]);
    expect(sentTo.map((s) => s.tab)).toEqual([1, 2]);
});

test('only the owner\'s release frees it', async () => {
    await claim(1);
    await claim(2);
    await release(1);
    await claim(3);
    expect(sentTo.map((s) => s.tab)).toEqual([1, 2]);
    await release(3);
    await claim(4);
    expect(sentTo.map((s) => s.tab)).toEqual([1, 2]);
});

test('a message without a tab claims nothing', async () => {
    expect(await claim(undefined)).toEqual({ ok: false });
});
