/**
 * What a viewer picked for the lines of one video: kept for that video,
 * over the viewer's languages, never changing them.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {})),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(store, items);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn() },
    },
};

import { chooseLineFor, lineChoiceFor, loadLineChoices, pairFor, resetLineChoices } from '../src/line-choice';

const mine = { learning: 'en', native: 'ru' };

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    resetLineChoices();
});

test('a video without picks shows the viewer\'s languages', () => {
    expect(pairFor(mine, lineChoiceFor('netflix:1'))).toEqual(mine);
    expect(pairFor(null, null)).toBeNull();
});

test('a pick holds for its video only, and is stored', async () => {
    chooseLineFor('netflix:1', 'second', 'pl');
    expect(pairFor(mine, lineChoiceFor('netflix:1'))).toEqual({ learning: 'en', native: 'pl' });
    expect(pairFor(mine, lineChoiceFor('netflix:2'))).toEqual(mine);
    resetLineChoices();
    await loadLineChoices();
    expect(lineChoiceFor('netflix:1')).toEqual({ first: undefined, second: 'pl' });
});

test('null puts the viewer\'s language back; a video with no picks left is dropped', () => {
    chooseLineFor('youtube:a', 'second', 'pl');
    chooseLineFor('youtube:a', 'second', null);
    expect(lineChoiceFor('youtube:a')).toBeNull();
    expect((store['lineChoice.v1'] as object)).toEqual({});
});

test('one language on both lines is no pair: the other line takes the viewer\'s other language', () => {
    expect(pairFor(mine, { first: 'ru' })).toEqual({ learning: 'ru', native: 'en' });
    expect(pairFor(mine, { second: 'en' })).toEqual({ learning: 'ru', native: 'en' });
});
