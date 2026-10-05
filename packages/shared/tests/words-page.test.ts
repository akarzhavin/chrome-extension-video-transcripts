/**
 * @jest-environment jsdom
 */

/**
 * The "My words" page (words.html): the words kept in this browser. It reads and
 * changes them only through the worker's messages, so the worker is a fake here
 * that answers from an in-memory list the test controls.
 */

type Word = { term: string; context: string; site: string; addedAt: number; translation?: string };

const storageListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
const store: Record<string, unknown> = {};
let words: Word[] = [];
let status: Record<string, unknown> = {};
/** LOOKUP_WORD calls waiting for the test to answer them. */
let lookups: Array<{ term: string; targetLang: string; site: string; reply: (r: unknown) => void }> = [];
let lookupMode: 'hold' | 'answer' = 'answer';
let lookupAnswer: (term: string) => unknown = () => ({ ok: true, result: { translations: [] } });
let removeAnswer: () => unknown = () => ({ ok: true });
const sent: any[] = [];

const respond = (msg: any, cb: (r: unknown) => void): void => {
    sent.push(msg);
    switch (msg.action) {
        case 'LOCAL_WORDS_LIST':
            cb({ ok: true, words: words.map((w) => ({ ...w })) });
            return;
        case 'AUTH_STATUS':
            cb(status);
            return;
        case 'LOOKUP_WORD':
            if (lookupMode === 'hold') lookups.push({ term: msg.term, targetLang: msg.targetLang, site: msg.site, reply: cb });
            else cb(lookupAnswer(msg.term));
            return;
        case 'LOCAL_WORD_SET_TRANSLATION': {
            const w = words.find((x) => x.term === msg.term);
            if (w) w.translation = msg.translation;
            cb({ ok: true });
            return;
        }
        case 'REMOVE_WORD': {
            const r = removeAnswer() as { ok: boolean };
            if (r.ok) words = words.filter((x) => x.term !== msg.term);
            cb(r);
            return;
        }
        case 'AUTH_SIGN_IN_VIA_LINGOGRAM':
            cb({ ok: true });
            return;
        default:
            cb({});
    }
};

const tabsCreate = jest.fn(async () => ({}));
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: jest.fn((msg: any, cb: any) => respond(msg, cb ?? (() => {}))),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' },
    tabs: { create: tabsCreate },
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? {});
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                Object.assign(store, items);
            }),
        },
        onChanged: {
            addListener: jest.fn((l: any) => storageListeners.push(l)),
            removeListener: jest.fn(),
        },
    },
};

import { readFileSync } from 'fs';
import { join } from 'path';
import { saveLanguagePrefs } from '../src/languages';

const WORDS_HTML = (() => {
    const file = readFileSync(join(__dirname, '../src/words/words.html'), 'utf8');
    const body = /<body>([\s\S]*?)<\/body>/.exec(file);
    if (!body) throw new Error('words.html has no <body>');
    return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

const word = (term: string, extra: Partial<Word> = {}): Word => ({
    term,
    context: '',
    site: '',
    addedAt: 1000,
    ...extra,
});

const SIGNED_OUT = { signedIn: false, inboxCount: 0, localCount: 0, needsReauth: false };

beforeEach(() => {
    document.body.innerHTML = WORDS_HTML;
    document.title = '';
    storageListeners.length = 0;
    for (const k of Object.keys(store)) delete store[k];
    words = [];
    status = { ...SIGNED_OUT };
    lookups = [];
    lookupMode = 'answer';
    lookupAnswer = () => ({ ok: true, result: { translations: [] } });
    removeAnswer = () => ({ ok: true });
    sent.length = 0;
    (chrome.runtime.sendMessage as jest.Mock)
        .mockReset()
        .mockImplementation((msg: any, cb: any) => respond(msg, cb ?? (() => {})));
    tabsCreate.mockClear();
    jest.resetModules();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await tick();
};

async function mount(): Promise<void> {
    const { initWords } = await import('../src/words/words');
    initWords();
    await settle();
}

const page = (): HTMLElement => document.getElementById('page')!;
const rows = (): HTMLElement[] => [...page().querySelectorAll<HTMLElement>('.word')];
const terms = (): string[] => rows().map((r) => r.querySelector('.term')!.textContent!);
const sentOf = (action: string): any[] => sent.filter((m) => m.action === action);
const search = (): HTMLInputElement => page().querySelector('input.search') as HTMLInputElement;
const type = async (q: string): Promise<void> => {
    search().value = q;
    search().dispatchEvent(new Event('input'));
    await tick();
};
const withNative = async (native = 'ru'): Promise<void> => {
    await saveLanguagePrefs({ learning: 'en', native });
};

test('the page carries the mount point and loads its own bundle and styles', () => {
    const file = readFileSync(join(__dirname, '../src/words/words.html'), 'utf8');
    expect(document.getElementById('page')).not.toBeNull();
    expect(file).toContain('<script src="src/words/words.js"></script>');
    expect(file).toContain('href="src/popup/popup.css"');
    expect(file).toContain('href="src/pages/page.css"');
});

describe('the header', () => {
    test('is titled "My words", counts the words, and links to Settings', async () => {
        words = [word('alpha'), word('beta'), word('gamma')];
        await mount();

        expect(page().querySelector('h1')!.textContent).toBe('My words');
        expect(document.title).toBe('My words');
        expect(page().querySelector('.head-count')!.textContent).toBe('3 words');
        const link = page().querySelector('a.link') as HTMLAnchorElement;
        expect(link.textContent).toBe('Settings');
        expect(link.getAttribute('href')).toBe('settings.html');
    });

    test('shows no count before the worker has answered', async () => {
        const { initWords } = await import('../src/words/words');
        initWords();

        expect((page().querySelector('.head-count') as HTMLElement).hidden).toBe(true);
        expect(page().textContent).not.toContain('No words yet');
    });
});

describe('the list', () => {
    test('one row per word, in the order the worker gave (newest first)', async () => {
        words = [word('newest'), word('middle'), word('oldest')];
        await mount();
        expect(terms()).toEqual(['newest', 'middle', 'oldest']);
    });

    test('a row: the word in bold, its translation after "·", the sentence in quotes, the source', async () => {
        words = [word('come up with', { translation: 'придумать', context: 'We had to come up with a plan.', site: 'youtube' })];
        await mount();

        const row = rows()[0];
        expect(row.querySelector('b.term')!.textContent).toBe('come up with');
        expect(row.querySelector('.tr')!.textContent).toBe('· придумать');
        expect(row.querySelector('.cx')!.textContent).toBe('“We had to come up with a plan.” · YouTube');
        expect(row.querySelector('button')!.textContent).toBe('Remove');
    });

    test('the source labels: youtube, netflix, rezka', async () => {
        words = [
            word('a', { context: 'x', site: 'youtube' }),
            word('b', { context: 'x', site: 'netflix' }),
            word('c', { context: 'x', site: 'rezka' }),
        ];
        await mount();
        expect(rows().map((r) => r.querySelector('.src')!.textContent)).toEqual([' · YouTube', ' · Netflix', ' · HDrezka']);
    });

    test('a save with no known source (web, other, empty, anything else) names none', async () => {
        words = [
            word('a', { context: 'x', site: 'web' }),
            word('b', { context: 'x', site: 'other' }),
            word('c', { context: 'x', site: '' }),
            word('d', { context: 'x', site: 'toString' }),
        ];
        await mount();

        expect(rows().map((r) => r.querySelector('.src'))).toEqual([null, null, null, null]);
        expect(rows().map((r) => r.querySelector('.cx')!.textContent)).toEqual(['“x”', '“x”', '“x”', '“x”']);
    });

    test('no sentence: the source stands alone; neither: no second line', async () => {
        words = [word('a', { site: 'netflix' }), word('b')];
        await mount();

        expect(rows()[0].querySelector('.cx')!.textContent).toBe('Netflix');
        expect(rows()[1].querySelector('.cx')).toBeNull();
    });

    test('a word without a translation leaves the cell blank', async () => {
        words = [word('alpha')];
        await mount();
        expect(rows()[0].querySelector('.tr')!.textContent).toBe('');
    });
});

describe('the states', () => {
    test('signed out with no words: "No words yet", no notice, no search', async () => {
        await mount();

        expect(page().querySelector('.empty b')!.textContent).toBe('No words yet');
        expect(page().querySelector('.empty')!.textContent).toContain('Click a word in the subtitles, then Save. Words you save show up here.');
        expect(page().querySelector('.note')).toBeNull();
        expect(search().hidden).toBe(true);
        expect(page().querySelector('.head-count')!.textContent).toBe('0 words');
    });

    test('signed out with words: the notice with the reason and a primary sign-in', async () => {
        words = [word('alpha')];
        await mount();

        const note = page().querySelector('.note')!;
        expect(note.querySelector('b')!.textContent).toBe('These words are stored only in this browser.');
        expect(note.querySelector('small')!.textContent).toBe(
            'Sign in to keep them on every device and practise them. They move to your account on their own.',
        );
        const b = note.querySelector('button')!;
        expect(b.textContent).toBe('Sign in on Lingogram');
        expect(b.className).toBe('primary');
        expect(page().querySelector('.empty')).toBeNull();
        expect(search().hidden).toBe(false);
    });

    test('the notice button starts the sign-in from the words page', async () => {
        words = [word('alpha')];
        await mount();
        sent.length = 0;

        (page().querySelector('.note button') as HTMLButtonElement).click();
        await tick();

        expect(sent).toEqual([{ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'words' }]);
    });

    test('signed in: a neutral card with "Open my vocabulary", not the notice', async () => {
        status = { signedIn: true, email: 'a@b.c', inboxCount: 387, localCount: 0, needsReauth: false };
        await mount();

        const note = page().querySelector('.note')!;
        expect(note.querySelector('b')!.textContent).toBe('Your words are in your Lingogram vocabulary.');
        expect(note.textContent).not.toContain('stored only in this browser');
        const open = note.querySelector('button')!;
        expect(open.textContent).toBe('Open my vocabulary');
        expect(open.className).toBe('primary');
        expect(page().querySelector('.empty')).toBeNull();
        expect(page().querySelector('.head-count')!.textContent).toBe('387 words');
    });

    test('"Open my vocabulary" opens the site vocabulary in a tab', async () => {
        status = { signedIn: true, email: 'a@b.c', inboxCount: 5 };
        await mount();

        (page().querySelector('.note button') as HTMLButtonElement).click();
        await tick();

        expect(tabsCreate.mock.calls).toEqual([[{ url: 'http://localhost:5173/app/vocab' }]]);
    });

    test('signed in with words still waiting: they are listed under their own heading', async () => {
        status = { signedIn: true, email: 'a@b.c', inboxCount: 10, localCount: 2 };
        words = [word('alpha'), word('beta')];
        await mount();

        expect(page().querySelector('.group-label')!.textContent).toBe('Waiting to be added to your account');
        expect(terms()).toEqual(['alpha', 'beta']);
    });

    test('signed in with nothing waiting: the card is the whole page', async () => {
        status = { signedIn: true, email: 'a@b.c', inboxCount: 10, localCount: 0 };
        await mount();

        expect(page().querySelector('.group-label')).toBeNull();
        expect(rows()).toHaveLength(0);
        expect(search().hidden).toBe(true);
    });

    test('a worker that cannot be reached shows the error', async () => {
        (chrome.runtime.sendMessage as jest.Mock).mockImplementationOnce((_m: any, cb: any) => {
            (chrome.runtime as any).lastError = { message: 'no receiving end' };
            cb(undefined);
            (chrome.runtime as any).lastError = undefined;
        });
        await mount();

        expect(page().querySelector('.error')!.textContent).toBe('Error: no receiving end');
    });
});

describe('search', () => {
    beforeEach(() => {
        words = [
            word('Come up with', { translation: 'придумать' }),
            word('scrap', { translation: 'отменить, выбросить' }),
            word('Courage', { translation: 'смелость' }),
        ];
    });

    test('filters by the word, case-insensitively, as you type', async () => {
        await mount();

        await type('CO');
        expect(terms()).toEqual(['Come up with', 'Courage']);

        await type('cour');
        expect(terms()).toEqual(['Courage']);
    });

    test('filters by the translation too', async () => {
        await mount();

        await type('ВЫБРОС');
        expect(terms()).toEqual(['scrap']);
    });

    test('an empty query shows everything again', async () => {
        await mount();
        await type('scr');
        expect(terms()).toEqual(['scrap']);

        await type('');
        expect(terms()).toEqual(['Come up with', 'scrap', 'Courage']);
    });

    test('the field is labelled and the count in the header stays the whole list', async () => {
        await mount();

        expect(search().placeholder).toBe('Search your words');
        expect(search().getAttribute('aria-label')).toBe('Search your words');
        await type('scr');
        expect(page().querySelector('.head-count')!.textContent).toBe('3 words');
    });
});

describe('Remove', () => {
    beforeEach(() => {
        words = [word('alpha', { site: 'youtube' }), word('beta')];
    });
    const remove = (i: number): HTMLButtonElement => rows()[i].querySelector('button') as HTMLButtonElement;

    test('sends REMOVE_WORD with the word and its site, and drops the row', async () => {
        await mount();
        sent.length = 0;

        remove(0).click();
        await settle();

        expect(sentOf('REMOVE_WORD')).toEqual([{ action: 'REMOVE_WORD', term: 'alpha', site: 'youtube' }]);
        expect(terms()).toEqual(['beta']);
        expect(page().querySelector('.head-count')!.textContent).toBe('1 words');
    });

    test('removing the last word shows the empty state', async () => {
        words = [word('alpha')];
        await mount();

        remove(0).click();
        await settle();

        expect(page().querySelector('.empty b')!.textContent).toBe('No words yet');
    });

    test('a refusal keeps the row and says so under it', async () => {
        removeAnswer = () => ({ ok: false, error: 'busy' });
        await mount();

        remove(0).click();
        await settle();

        expect(terms()).toEqual(['alpha', 'beta']);
        const err = rows()[0].querySelector('.error')!;
        expect(err.textContent).toBe("Couldn't remove the word. Try again.");
        expect(err.getAttribute('role')).toBe('alert');
        expect(remove(0).disabled).toBe(false);
    });

    test('a worker that does not answer counts as a failure', async () => {
        await mount();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementationOnce((_m: any, cb: any) => {
            (chrome.runtime as any).lastError = { message: 'gone' };
            cb(undefined);
            (chrome.runtime as any).lastError = undefined;
        });

        remove(0).click();
        await settle();

        expect(terms()).toEqual(['alpha', 'beta']);
        expect(rows()[0].querySelector('.error')!.textContent).toBe("Couldn't remove the word. Try again.");
    });

    test('a second try clears the earlier error', async () => {
        removeAnswer = () => ({ ok: false });
        await mount();
        remove(0).click();
        await settle();
        removeAnswer = () => ({ ok: true });

        remove(0).click();
        await settle();

        expect(terms()).toEqual(['beta']);
    });
});

describe('refreshing', () => {
    test('a change to the stored words redraws the list', async () => {
        words = [word('alpha')];
        await mount();

        words = [word('beta'), word('alpha')];
        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
        await settle();

        expect(terms()).toEqual(['beta', 'alpha']);
        expect(page().querySelector('.head-count')!.textContent).toBe('2 words');
    });

    test('so does a change of the mirror or of the account', async () => {
        await mount();
        words = [word('alpha')];
        for (const l of storageListeners) l({ 'words.v1': { newValue: {} } }, 'local');
        await settle();
        expect(terms()).toEqual(['alpha']);

        status = { signedIn: true, email: 'a@b.c', inboxCount: 9 };
        for (const l of storageListeners) l({ 'auth.email': { newValue: 'a@b.c' } }, 'local');
        await settle();
        expect(page().querySelector('.note b')!.textContent).toBe('Your words are in your Lingogram vocabulary.');
    });

    test('other keys and other areas change nothing', async () => {
        words = [word('alpha')];
        await mount();
        sent.length = 0;

        for (const l of storageListeners) l({ 'prefs.v1': { newValue: {} } }, 'local');
        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'session');
        await settle();

        expect(sent).toEqual([]);
    });

    test('keeps what was typed in the search while the list redraws', async () => {
        words = [word('alpha'), word('beta')];
        await mount();
        await type('be');

        words = [word('gamma'), word('beta'), word('alpha')];
        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
        await settle();

        expect(search().value).toBe('be');
        expect(terms()).toEqual(['beta']);
    });
});

describe('translations looked up on the page', () => {
    test('a word without a translation is looked up for the native language, and the result is shown and stored', async () => {
        await withNative('ru');
        words = [word('alpha', { site: 'youtube' })];
        lookupAnswer = () => ({ ok: true, result: { translations: ['альфа', 'первый', 'начало', 'четвёртый'] } });
        await mount();

        expect(sentOf('LOOKUP_WORD')).toEqual([
            { action: 'LOOKUP_WORD', term: 'alpha', context: '', targetLang: 'ru', site: 'other' },
        ]);
        expect(rows()[0].querySelector('.tr')!.textContent).toBe('· альфа, первый, начало');
        expect(sentOf('LOCAL_WORD_SET_TRANSLATION')).toEqual([
            { action: 'LOCAL_WORD_SET_TRANSLATION', term: 'alpha', translation: 'альфа, первый, начало' },
        ]);
    });

    test('a word that already has a translation is not looked up', async () => {
        await withNative();
        words = [word('alpha', { translation: 'альфа' })];
        await mount();
        expect(sentOf('LOOKUP_WORD')).toEqual([]);
    });

    test('without a native language nothing is looked up', async () => {
        words = [word('alpha'), word('beta')];
        await mount();

        expect(sentOf('LOOKUP_WORD')).toEqual([]);
        expect(rows().map((r) => r.querySelector('.tr')!.textContent)).toEqual(['', '']);
    });

    test('at most two lookups are in flight; the next starts when one finishes', async () => {
        await withNative();
        words = [word('a'), word('b'), word('c'), word('d')];
        lookupMode = 'hold';
        await mount();

        expect(lookups.map((l) => l.term)).toEqual(['a', 'b']);

        lookups[0].reply({ ok: true, result: { translations: ['x'] } });
        await settle();
        expect(lookups.map((l) => l.term)).toEqual(['a', 'b', 'c']);

        lookups[1].reply({ ok: false, error: 'lookup not configured' });
        await settle();
        expect(lookups.map((l) => l.term)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('a failed or unconfigured lookup leaves the cell blank, with no error text and no retry', async () => {
        await withNative();
        words = [word('alpha'), word('beta')];
        lookupAnswer = (term) => (term === 'alpha' ? { ok: false, error: 'lookup not configured' } : { ok: true, result: { translations: [] } });
        await mount();
        await settle();

        expect(rows().map((r) => r.querySelector('.tr')!.textContent)).toEqual(['', '']);
        expect(page().querySelector('.error')).toBeNull();
        expect(sentOf('LOOKUP_WORD').map((m) => m.term)).toEqual(['alpha', 'beta']);
        expect(sentOf('LOCAL_WORD_SET_TRANSLATION')).toEqual([]);
    });

    test('a lookup that throws is swallowed the same way', async () => {
        await withNative();
        words = [word('alpha')];
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((msg: any, cb: any) => {
            if (msg.action === 'LOOKUP_WORD') throw new Error('context invalidated');
            respond(msg, cb);
        });
        await mount();

        expect(rows()[0].querySelector('.tr')!.textContent).toBe('');
        expect(page().querySelector('.error')).toBeNull();
    });

    test('a term is never looked up twice in one page session, even after redraws', async () => {
        await withNative();
        words = [word('alpha'), word('Beta')];
        await mount();
        expect(sentOf('LOOKUP_WORD')).toHaveLength(2);

        // The stored list comes back, still without translations (nothing found).
        for (let i = 0; i < 3; i++) {
            for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
            await settle();
        }

        expect(sentOf('LOOKUP_WORD').map((m) => m.term)).toEqual(['alpha', 'Beta']);
    });

    test('the same word in another capitalisation counts as the same term', async () => {
        await withNative();
        words = [word('Alpha')];
        await mount();
        words = [word('alpha')];
        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
        await settle();

        expect(sentOf('LOOKUP_WORD')).toHaveLength(1);
    });

    test('a word removed while it waits in the queue is never looked up', async () => {
        await withNative();
        words = [word('a'), word('b'), word('c')];
        lookupMode = 'hold';
        await mount();
        expect(lookups.map((l) => l.term)).toEqual(['a', 'b']);

        words = [word('a'), word('b')];
        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
        await settle();
        lookups[0].reply({ ok: true, result: { translations: ['x'] } });
        lookups[1].reply({ ok: true, result: { translations: ['y'] } });
        await settle();

        expect(lookups.map((l) => l.term)).toEqual(['a', 'b']);
    });

    test('a translation found shows at once and survives the redraw that follows its storing', async () => {
        await withNative();
        words = [word('alpha')];
        lookupAnswer = () => ({ ok: true, result: { translations: ['альфа'] } });
        await mount();

        for (const l of storageListeners) l({ 'localWords.v1': { newValue: {} } }, 'local');
        await settle();

        expect(rows()[0].querySelector('.tr')!.textContent).toBe('· альфа');
        expect(sentOf('LOOKUP_WORD')).toHaveLength(1);
    });

    test('a found translation is searchable', async () => {
        await withNative();
        words = [word('alpha'), word('beta')];
        lookupAnswer = (term) => ({ ok: true, result: { translations: [term === 'alpha' ? 'альфа' : 'бета'] } });
        await mount();

        await type('альф');

        expect(terms()).toEqual(['alpha']);
    });
});
