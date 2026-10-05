/**
 * @jest-environment jsdom
 *
 * Google Translate import (specs/gt-import/spec.md): the page reader, the plan,
 * and the worker's two steps. The page blob in these tests copies the row shape
 * measured on the live translate.google.com/saved on 2026-10-03.
 */

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const area = (store: Record<string, unknown>) => ({
    get: jest.fn(async (keys: any) => {
        const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
    }),
    set: jest.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, JSON.parse(JSON.stringify(items)));
    }),
    remove: jest.fn(async (keys: any) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) delete store[k];
    }),
});

let pageResult: unknown;
const removedTabs: number[] = [];
(global as any).chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: jest.fn(), removeListener: jest.fn() } },
    runtime: { id: 'ext', getManifest: () => ({ version: '0.0.0' }), sendMessage: jest.fn(), onMessage: { addListener: jest.fn() } },
    i18n: { getMessage: () => '' },
    tabs: {
        create: jest.fn(async () => ({ id: 7 })),
        remove: jest.fn(async (id: number) => {
            removedTabs.push(id);
        }),
        onUpdated: {
            addListener: jest.fn((l: any) => setTimeout(() => l(7, { status: 'complete' }), 0)),
            removeListener: jest.fn(),
        },
    },
    scripting: { executeScript: jest.fn(async () => [{ result: pageResult }]) },
};

const addInboxWord = jest.fn();
const listInboxWords = jest.fn();
jest.mock('../src/auth/firestoreRest', () => ({
    addInboxWord: (...a: unknown[]) => addInboxWord(...a),
    listInboxWords: (...a: unknown[]) => listInboxWords(...a),
}));
jest.mock('../src/analytics-bg', () => ({ track: jest.fn(async () => {}) }));
const devEnvReady = jest.fn(async () => {});
jest.mock('../src/auth/background', () => ({ stampLocalWrite: jest.fn(), devEnvReady: () => devEnvReady() }));
jest.mock('../src/auth/config', () => ({ config: {} }));

import { readGoogleSaved, type SavedPair } from '../src/gt-import/read-saved';
import { learningSide, planImport } from '../src/gt-import/plan';
import { confirmImport, importSenderAllowed, installGtImport, loadImportState, resetImport, resumeInterrupted, startImport } from '../src/gt-import/runner';
import { loadMirror } from '../src/word-mirror';

const pair = (srcLang: string, srcText: string, dstLang: string, dstText: string): SavedPair => ({
    srcLang,
    srcText,
    dstLang,
    dstText,
});

describe('readGoogleSaved', () => {
    afterEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    function blob(key: string, data: unknown): void {
        const s = document.createElement('script');
        // Inert here (jsdom would run it); the reader only reads the text.
        s.type = 'text/plain';
        s.textContent = `AF_initDataCallback({key: '${key}', hash: '9', data:${JSON.stringify(data)}, sideChannel: {}});`;
        document.body.appendChild(s);
    }

    test('reads every row of the list blob, whatever its key is called', () => {
        blob('ds:0', [['not', 'rows']]);
        // The decoy the live page carries first: the language list, rows of
        // short strings with no timestamp.
        blob('ds:3', [[['ach', 'ab', 'ace', 'aa', 'af'], ['ak', 'sq', 'am', 'ar', 'hy']]]);
        blob('ds:7', [
            [
                ['id1', 'ru', 'en', 'переоценивают\nнедооценивают', 'overestimate\nunderestimate', 1790173340970488, null, [1]],
                ['id2', 'en', 'ru', 'come up with', 'придумать', 1789130423470908, null, [1]],
            ],
        ]);
        const r = readGoogleSaved();
        expect(r.via).toBe('data');
        expect(r.pairs).toEqual([
            pair('ru', 'переоценивают\nнедооценивают', 'en', 'overestimate\nunderestimate'),
            pair('en', 'come up with', 'ru', 'придумать'),
        ]);
    });

    test('no blob of that shape → none, never the ten cards of one page', () => {
        blob('ds:0', [[1, 2, 3]]);
        document.body.insertAdjacentHTML(
            'beforeend',
            '<ol jsname="Ck9yr"><li><span jsname="diQUje" lang="en">card</span><span jsname="WHdkge" lang="ru">карта</span></li></ol>',
        );
        expect(readGoogleSaved()).toEqual({ via: 'none', pairs: [] });
    });
});

describe('planImport', () => {
    test('takes the learning side in either direction, region tags included', () => {
        expect(learningSide(pair('ru', 'сани', 'en', 'sled'), 'en')).toBe('sled');
        expect(learningSide(pair('en-US', 'come up with', 'ru', 'x'), 'en')).toBe('come up with');
        expect(learningSide(pair('pl', 'a', 'ru', 'b'), 'en')).toBeNull();
    });

    test('splits multi-line saves, collapses duplicates, sorts by what the server holds', () => {
        const known = new Map([
            ['sled', 'active' as const],
            ['outcome', 'removed' as const],
        ]);
        const plan = planImport(
            [
                pair('ru', 'переоценивают\nнедооценивают', 'en', 'overestimate\nunderestimate'),
                pair('en', 'Come up  with', 'ru', 'x'),
                pair('en', 'come up with', 'ru', 'y'),
                pair('ru', 'сани', 'en', 'Sled'),
                pair('en', 'outcome', 'ru', 'исход'),
                pair('pl', 'a', 'ru', 'b'),
                pair('en', 'x'.repeat(300), 'ru', 'long'),
            ],
            'en',
            known,
            256,
        );
        expect(plan.toAdd).toEqual(['overestimate', 'underestimate', 'Come up  with']);
        expect(plan.already).toBe(1);
        expect(plan.removed).toBe(1);
        expect(plan.skipped).toBe(2);
    });
});

describe('who may drive the import', () => {
    const tab = { id: 1 } as chrome.tabs.Tab;
    test.each([
        ['the popup', { id: 'ext' }, true],
        ['its button on Google Translate', { id: 'ext', tab, frameId: 0, origin: 'https://translate.google.com' }, true],
        ['the same, by url', { id: 'ext', tab, frameId: 0, url: 'https://translate.google.com/saved' }, true],
        ['its own page in a tab (settings)', { id: 'ext', tab, frameId: 0, origin: 'chrome-extension://ext' }, true],
        ['a frame of its own page', { id: 'ext', tab, frameId: 2, origin: 'chrome-extension://ext' }, false],
        ['a page of another extension', { id: 'ext', tab, frameId: 0, origin: 'chrome-extension://other' }, false],
        ['a frame inside Google Translate', { id: 'ext', tab, frameId: 3, origin: 'https://translate.google.com' }, false],
        ['its content script on YouTube', { id: 'ext', tab, frameId: 0, origin: 'https://www.youtube.com' }, false],
        ['a look-alike host', { id: 'ext', tab, frameId: 0, origin: 'https://translate.google.com.evil.test' }, false],
        ['another extension', { id: 'other' }, false],
    ])('%s', (_name, sender, ok) => {
        expect(importSenderAllowed(sender as chrome.runtime.MessageSender)).toBe(ok);
    });
});

describe('runner', () => {
    beforeEach(async () => {
        for (const k of Object.keys(local)) delete local[k];
        for (const k of Object.keys(session)) delete session[k];
        removedTabs.length = 0;
        addInboxWord.mockReset();
        listInboxWords.mockReset();
        local['auth.idToken'] = 't';
        local['auth.refreshToken'] = 'r';
        local['auth.uid'] = 'u1';
        local['auth.email'] = 'a@b.c';
        local['auth.expiresAt'] = Date.now() + 3_600_000;
        await resetImport();
    });

    test('signed out → the list is read first, so the card can say how many phrases wait', async () => {
        for (const k of Object.keys(local)) delete local[k];
        pageResult = { via: 'data', pairs: [pair('en', 'one', 'ru', '1'), pair('en', 'two', 'ru', '2'), pair('ru', 'три', 'en', 'three')] };
        const s = await startImport();
        expect(s.phase).toBe('error');
        expect(s.error).toBe('not_signed_in');
        expect(s.found).toBe(3);
        // Nothing of the account is touched without one.
        expect(listInboxWords).not.toHaveBeenCalled();
        expect(removedTabs).toEqual([7]);
    });

    test('signed out with no list on the page → the no-list error, not a sign-in', async () => {
        for (const k of Object.keys(local)) delete local[k];
        pageResult = { via: 'none', pairs: [] };
        const s = await startImport();
        expect(s.error).toBe('no_list');
    });

    test('preview counts come from the server list; the opened tab is closed', async () => {
        pageResult = {
            via: 'data',
            pairs: [
                pair('en', 'one', 'ru', '1'),
                pair('en', 'two', 'ru', '2'),
                pair('en', 'three', 'ru', '3'),
                pair('en', 'gone', 'ru', 'x'),
                pair('en', 'have', 'ru', 'x'),
            ],
        };
        listInboxWords.mockResolvedValue([
            { key: 'k1', term: 'gone', state: 'removed', updatedAt: 1 },
            { key: 'k2', term: 'have', state: 'active', updatedAt: 2 },
        ]);
        const s = await startImport();
        expect(listInboxWords).toHaveBeenCalledWith({}, 0);
        expect(s.phase).toBe('preview');
        expect(s.already).toBe(1);
        expect(s.removed).toBe(1);
        // Every new word, in a dev build too (jest.setup): no cap per run.
        expect(s.toAdd).toEqual(['one', 'two', 'three']);
        expect(s.total).toBe(3);
        expect(removedTabs).toEqual([7]);
        expect(addInboxWord).not.toHaveBeenCalled();
    });

    test('empty page → no_list error', async () => {
        pageResult = { via: 'none', pairs: [] };
        const s = await startImport();
        expect(s.error).toBe('no_list');
        expect(listInboxWords).not.toHaveBeenCalled();
    });

    test('confirm writes create-only, fills the mirror, counts refusals honestly', async () => {
        pageResult = { via: 'data', pairs: [pair('en', 'alpha', 'ru', 'a'), pair('en', 'beta', 'ru', 'b')] };
        listInboxWords.mockResolvedValue([]);
        await startImport();
        addInboxWord
            .mockResolvedValueOnce({ wordId: 'w', documentPath: 'p', state: 'active' })
            .mockRejectedValueOnce(new Error('Firestore exists 409'));
        const s = await confirmImport();
        expect(addInboxWord.mock.calls.map((c) => c[2])).toEqual([{ createOnly: true }, { createOnly: true }]);
        expect(s?.phase).toBe('done');
        expect(s?.added).toBe(1);
        expect(s?.existed).toBe(1);
        expect(s?.done).toBe(2);
        expect((await loadMirror()).words).toEqual({ alpha: 'active' });
    });

    test('a rules refusal is retried once after the one-second gap', async () => {
        pageResult = { via: 'data', pairs: [pair('en', 'alpha', 'ru', 'a')] };
        listInboxWords.mockResolvedValue([]);
        await startImport();
        addInboxWord
            .mockRejectedValueOnce(new Error('Firestore rules 403: denied'))
            .mockResolvedValueOnce({ wordId: 'w', documentPath: 'p', state: 'active' });
        const t0 = Date.now();
        const s = await confirmImport();
        expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
        expect(addInboxWord).toHaveBeenCalledTimes(2);
        expect(s?.added).toBe(1);
        expect(s?.refused).toBe(0);
    });

    test('daily limit stops the run and keeps what was written', async () => {
        pageResult = { via: 'data', pairs: [pair('en', 'alpha', 'ru', 'a'), pair('en', 'beta', 'ru', 'b')] };
        listInboxWords.mockResolvedValue([]);
        await startImport();
        addInboxWord
            .mockResolvedValueOnce({ wordId: 'w', documentPath: 'p', state: 'active' })
            .mockRejectedValueOnce(new Error('Daily limit of 500 words reached. Try again tomorrow.'));
        const s = await confirmImport();
        expect(s?.phase).toBe('error');
        expect(s?.error).toBe('daily_limit');
        expect(s?.added).toBe(1);
        expect(s?.done).toBe(1);
        expect((await loadImportState())?.phase).toBe('error');
    });

    const writingState = (over: object = {}) => ({
        phase: 'writing',
        toAdd: ['alpha', 'beta'],
        already: 0,
        removed: 0,
        skipped: 0,
        total: 2,
        done: 1,
        added: 1,
        existed: 0,
        refused: 0,
        ...over,
    });
    const flush = async () => {
        for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    };
    // A save that hangs until the test lets it go. Released before the test
    // ends, so the run finishes and the next test does not find one in flight.
    const hanging = () => {
        let release!: () => void;
        const p = new Promise<object>((r) => (release = () => r({ wordId: 'w', documentPath: 'p', state: 'active' })));
        return { p, release };
    };

    test('the dev backend is restored before the list or a word goes to the server', async () => {
        // A worker woken by the page button, not by an auth message, must not
        // talk to the build's default target (the local emulators).
        const order: string[] = [];
        devEnvReady.mockImplementation(async () => {
            order.push('env');
        });
        listInboxWords.mockImplementation(async () => {
            order.push('list');
            return [];
        });
        addInboxWord.mockImplementation(async () => {
            order.push('write');
            return { wordId: 'w', documentPath: 'p', state: 'active' };
        });
        pageResult = { via: 'data', pairs: [pair('en', 'alpha', 'ru', 'a')] };
        await startImport();
        await confirmImport();
        expect(order).toEqual(['env', 'list', 'env', 'write']);
        devEnvReady.mockImplementation(async () => {});
    });

    test('a page that never finishes loading: the import gives up and the hidden tab is closed', async () => {
        jest.useFakeTimers();
        const add = chrome.tabs.onUpdated.addListener as jest.Mock;
        add.mockImplementationOnce(() => undefined); // 'complete' never arrives
        try {
            const run = startImport();
            await jest.advanceTimersByTimeAsync(31_000);
            const s = await run;
            expect(s.error).toBe('tab_failed');
            expect(removedTabs).toEqual([7]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('words are counted as they land, not only when the whole list is done', async () => {
        pageResult = { via: 'data', pairs: [pair('en', 'alpha', 'ru', 'a'), pair('en', 'beta', 'ru', 'b')] };
        listInboxWords.mockResolvedValue([]);
        await startImport();
        const stop = hanging(); // the worker stops here
        addInboxWord.mockResolvedValueOnce({ wordId: 'w', documentPath: 'p', state: 'active' }).mockImplementationOnce(() => stop.p);
        const run = confirmImport();
        await flush();
        expect((await loadMirror()).words).toEqual({ alpha: 'active' });
        stop.release();
        await run;
    });

    test('the popup gets its answer before the words are written', async () => {
        session['gtImport.v1'] = writingState({ done: 0, added: 0, phase: 'preview' });
        const long = hanging();
        addInboxWord.mockImplementation(() => long.p); // a long write
        (chrome.runtime.onMessage.addListener as jest.Mock).mockClear();
        installGtImport();
        const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
        const sendResponse = jest.fn();
        expect(listener({ action: 'GT_IMPORT_CONFIRM' }, { id: 'ext' }, sendResponse)).toBe(true);
        await flush();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
        expect(addInboxWord).toHaveBeenCalled();
        long.release();
        await flush();
        expect((await loadImportState())?.phase).toBe('done');
    });

    test('a worker that starts with an import half written carries on by itself', async () => {
        session['gtImport.v1'] = writingState();
        addInboxWord.mockResolvedValue({ wordId: 'w', documentPath: 'p', state: 'active' });
        installGtImport();
        await flush();
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['beta']);
        expect((await loadImportState())?.phase).toBe('done');
    });

    test('the button on Google Translate gets the state by asking; YouTube gets nothing', async () => {
        // A preview: nothing for the installer to resume, so no write is left running.
        session['gtImport.v1'] = writingState({ phase: 'preview', done: 0, added: 0 });
        (chrome.runtime.onMessage.addListener as jest.Mock).mockClear();
        installGtImport();
        const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
        const fromGt = jest.fn();
        expect(listener({ action: 'GT_IMPORT_STATE' }, { id: 'ext', tab: { id: 1 }, frameId: 0, origin: 'https://translate.google.com' }, fromGt)).toBe(true);
        await flush();
        expect(fromGt).toHaveBeenCalledWith({ ok: true, state: expect.objectContaining({ phase: 'preview', total: 2 }) });
        expect(listener({ action: 'GT_IMPORT_STATE' }, { id: 'ext', tab: { id: 1 }, frameId: 0, origin: 'https://www.youtube.com' }, jest.fn())).toBe(false);
    });

    test('a worker that starts with nothing half written writes nothing', async () => {
        session['gtImport.v1'] = writingState({ phase: 'preview', done: 0, added: 0 });
        await resumeInterrupted();
        expect(addInboxWord).not.toHaveBeenCalled();
        expect((await loadImportState())?.phase).toBe('preview');
    });

    test('a worker whose session storage fails at start keeps running (no unhandled rejection)', async () => {
        const get = chrome.storage.session.get as jest.Mock;
        const before = get.getMockImplementation();
        get.mockImplementationOnce(() => Promise.reject(new Error('storage gone')));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        try {
            installGtImport();
            await flush();
            await new Promise((r) => setTimeout(r, 0));
            expect(unhandled).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('[Lingogram] GT import resume failed:', expect.any(Error));
        } finally {
            process.off('unhandledRejection', unhandled);
            warn.mockRestore();
            if (before) get.mockImplementation(before);
        }
    });

    test('a stopped worker resumes from `done`, not from the start', async () => {
        session['gtImport.v1'] = {
            phase: 'writing',
            toAdd: ['alpha', 'beta'],
            already: 0,
            removed: 0,
            skipped: 0,
            total: 2,
            done: 1,
            added: 1,
            existed: 0,
            refused: 0,
        };
        addInboxWord.mockResolvedValue({ wordId: 'w', documentPath: 'p', state: 'active' });
        const s = await confirmImport();
        expect(addInboxWord).toHaveBeenCalledTimes(1);
        expect(addInboxWord.mock.calls[0][1]).toEqual({ term: 'beta', context: '' });
        expect(s?.added).toBe(2);
    });
});
