/**
 * @jest-environment jsdom
 *
 * Words saved without an account (local-words.ts): the browser-side list a
 * signed-out learner builds and the worker later moves into an account.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'ext' },
    storage: {
        local: {
            get: jest.fn(async (k: string) => (k in store ? { [k]: store[k] } : {})),
            set: jest.fn(async (o: Record<string, unknown>) => {
                for (const [k, v] of Object.entries(o)) store[k] = JSON.parse(JSON.stringify(v));
            }),
        },
    },
};

import {
    addLocalWord,
    countLocalWords,
    listLocalWords,
    removeLocalWord,
    removeLocalWords,
    setLocalTranslation,
} from '../src/local-words';

const KEY = 'localWords.v1';
const stored = () => (store[KEY] as { words: Record<string, any> }).words;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(1_000);
});
afterEach(() => jest.useRealTimers());

test('a saved word is kept under its normalised key, with the term as the learner saved it', async () => {
    await addLocalWord({ term: 'Run  Away', context: 'He will run away.', site: 'youtube' });
    expect(store[KEY]).toEqual({
        words: {
            'run away': { term: 'Run  Away', context: 'He will run away.', site: 'youtube', addedAt: 1000 },
        },
    });
});

test('saving a word again keeps its first addedAt and its translation, and does not duplicate it', async () => {
    await addLocalWord({ term: 'Dawn', context: 'first', site: 'youtube' });
    await setLocalTranslation('dawn', 'рассвет');
    jest.setSystemTime(9_000);
    await addLocalWord({ term: 'DAWN', context: 'second', site: 'rezka' });
    expect(Object.keys(stored())).toEqual(['dawn']);
    expect(stored().dawn).toEqual({ term: 'Dawn', context: 'second', site: 'youtube', addedAt: 1000, translation: 'рассвет' });
});

test('a repeat save with no context does not erase the context already kept', async () => {
    await addLocalWord({ term: 'dawn', context: 'the sentence', site: 'youtube' });
    await addLocalWord({ term: 'dawn', context: '', site: 'web' });
    expect(stored().dawn.context).toBe('the sentence');
});

test('list is newest first and count matches', async () => {
    await addLocalWord({ term: 'one' });
    jest.setSystemTime(2_000);
    await addLocalWord({ term: 'two' });
    jest.setSystemTime(3_000);
    await addLocalWord({ term: 'three' });
    expect((await listLocalWords()).map((w) => w.term)).toEqual(['three', 'two', 'one']);
    expect(await countLocalWords()).toBe(3);
});

test('remove drops one word by any spelling of its key; remove-many drops several', async () => {
    await addLocalWord({ term: 'Alpha' });
    await addLocalWord({ term: 'beta' });
    await addLocalWord({ term: 'gamma' });
    await removeLocalWord('ALPHA');
    expect(Object.keys(stored()).sort()).toEqual(['beta', 'gamma']);
    await removeLocalWords(['Beta', 'gamma', 'never-saved']);
    expect(await countLocalWords()).toBe(0);
});

test('a translation is attached to the word, an empty one clears it, an unknown term is ignored', async () => {
    await addLocalWord({ term: 'dawn' });
    await setLocalTranslation('Dawn', 'рассвет');
    expect(stored().dawn.translation).toBe('рассвет');
    await setLocalTranslation('dawn', '');
    expect(stored().dawn).not.toHaveProperty('translation');
    await setLocalTranslation('ghost', 'x');
    expect(Object.keys(stored())).toEqual(['dawn']);
});

test('a missing or garbage stored value is an empty list', async () => {
    expect(await listLocalWords()).toEqual([]);
    for (const junk of [null, 5, 'x', [], { words: 7 }, { words: null }]) {
        store[KEY] = junk;
        expect(await countLocalWords()).toBe(0);
    }
});

test('one damaged record costs only itself', async () => {
    store[KEY] = {
        words: {
            good: { term: 'good', context: '', site: 'web', addedAt: 5 },
            bad: { term: 3 },
            worse: null,
        },
    };
    expect((await listLocalWords()).map((w) => w.term)).toEqual(['good']);
});

test('two saves racing each other both land', async () => {
    await Promise.all([addLocalWord({ term: 'a' }), addLocalWord({ term: 'b' }), removeLocalWord('zzz')]);
    expect(Object.keys(stored()).sort()).toEqual(['a', 'b']);
});

test('an empty term is refused and nothing is stored', async () => {
    await expect(addLocalWord({ term: '   ' })).rejects.toThrow('term required');
    expect(store[KEY]).toBeUndefined();
});
