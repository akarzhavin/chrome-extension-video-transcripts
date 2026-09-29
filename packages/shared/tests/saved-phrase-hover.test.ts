/**
 * @jest-environment jsdom
 *
 * Pointing at a word of a SAVED PHRASE opens the phrase's card.
 *
 * Seen live: "To track down" was selected, saved and underlined — and a hover
 * on "track" then opened the card for "track" alone. The phrase's translation
 * and its filled heart were nowhere, so the save looked as if it had not
 * happened. The underline says "these words are one saved thing"; the card
 * has to agree with it.
 */

const store: Record<string, unknown> = {};
const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return Promise.resolve(out);
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(items)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
            remove: jest.fn(() => Promise.resolve()),
        },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        onChanged: {
            addListener: jest.fn((l: any) => { listeners.push(l); }),
            removeListener: jest.fn((l: any) => {
                const i = listeners.indexOf(l);
                if (i !== -1) listeners.splice(i, 1);
            }),
        },
    },
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' },
};

import { setMirrorEntry } from '../src/word-mirror';
import {
    markSavedPhrasesIn,
    startSavedMarks,
    __resetSavedMarksForTest,
} from '../src/transcript/saved-marks';
import { installLookupStrip } from '../src/lookup/strip';

const RECT = { top: 400, bottom: 420, left: 100, right: 160, width: 60, height: 20, x: 100, y: 400, toJSON: () => ({}) } as DOMRect;
const card = (): HTMLElement | null => document.getElementById('lingogram-lookup-strip');
const lookups = (): string[] => (chrome.runtime.sendMessage as jest.Mock).mock.calls
    .map((c) => c[0]).filter((m: any) => m?.action === 'LOOKUP_WORD').map((m: any) => m.term);

/** A caption line as the builders make it: one span per word, spaced. */
function line(scope: 'overlay' | 'sidebar', ...words: string[]): HTMLElement[] {
    const item = document.createElement('div');
    item.className = scope === 'overlay' ? 'vtt-overlay' : 'vtt-item';
    item.dataset.index = '0';
    const main = document.createElement('div');
    main.className = scope === 'overlay' ? 'vtt-overlay-main' : 'vtt-main-text';
    main.dataset.index = '0';
    words.forEach((w, i) => {
        if (i > 0) main.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.dataset.word = w;
        span.textContent = w;
        span.getBoundingClientRect = () => RECT;
        main.appendChild(span);
    });
    item.appendChild(main);
    document.body.appendChild(item);
    markSavedPhrasesIn(main);
    return [...main.querySelectorAll<HTMLElement>('span[data-word]')];
}

let stopMarks: (() => void) | undefined;
let teardown: (() => void) | undefined;

beforeEach(async () => {
    Object.keys(store).forEach((k) => delete store[k]);
    listeners.length = 0;
    document.body.innerHTML = '';
    __resetSavedMarksForTest();
    store['lang.v1'] = { learning: 'en', native: 'ru' };
    await setMirrorEntry('to track down', 'active');
    stopMarks = startSavedMarks();
    await new Promise((r) => setTimeout(r, 0));
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((msg: any, cb?: (r: unknown) => void) => {
        const res = msg?.action === 'LOOKUP_WORD'
            ? { ok: true, result: { term: msg.term, lemma: msg.term, translations: [`перевод: ${msg.term}`], parts_of_speech: [], source: 'google' } }
            : { ok: true };
        cb?.(res);
    });
    teardown = installLookupStrip();
    await new Promise((r) => setTimeout(r, 0));
});

afterEach(() => {
    teardown?.();
    stopMarks?.();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('over the video: a word of a saved phrase opens the phrase, with its heart filled', async () => {
    const spans = line('overlay', 'To', 'track', 'down', '12', 'of');
    spans[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 130, clientY: 410 }));
    await wait(350);

    expect(lookups()).toEqual(['to track down']);
    expect(card()?.dataset.word).toBe('to track down');
    expect(card()?.querySelector('.vtt-lookup-heart.saved')).not.toBeNull();
});

test('moving on to the next word of the same phrase asks nothing new', async () => {
    const spans = line('overlay', 'To', 'track', 'down', '12', 'of');
    spans[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 130, clientY: 410 }));
    await wait(350);
    spans[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 150, clientY: 410 }));
    await wait(350);

    expect(lookups()).toEqual(['to track down']);
    expect(card()?.dataset.word).toBe('to track down');
});

test('a word outside the phrase still opens its own card', async () => {
    const spans = line('overlay', 'To', 'track', 'down', '12', 'of');
    spans[4].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 190, clientY: 410 }));
    await wait(350);

    expect(lookups()).toEqual(['of']);
});

test('in the sidebar: resting on a word of a saved phrase opens the phrase', async () => {
    const spans = line('sidebar', 'To', 'track', 'down', '12', 'of');
    spans[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 130, clientY: 410 }));
    await wait(650);

    expect(lookups()).toEqual(['to track down']);
    expect(card()?.dataset.word).toBe('to track down');
});
