/**
 * @jest-environment jsdom
 */

/**
 * The extension's own settings page (settings.html): everything that left the
 * toolbar popup. It works signed in or out, so each block is checked against the
 * account states the worker can report.
 *
 * The page is loaded from settings.html rather than hand-written, for the same
 * reason as the popup: a mount point renamed there fails here, not in the field.
 */

const sendMessageMock = jest.fn();
const storageListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

const store: Record<string, unknown> = {};
const storageLocal = {
    get: jest.fn((keys: string | string[] | null) => {
        if (keys == null) return Promise.resolve({ ...store });
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return Promise.resolve(out);
    }),
    // Like Chrome: a write wakes the page's own onChanged listeners too.
    set: jest.fn((items: Record<string, unknown>) => {
        const changes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: store[k], newValue: v };
        Object.assign(store, items);
        for (const l of [...storageListeners]) l(changes, 'local');
        return Promise.resolve();
    }),
};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: sendMessageMock,
        lastError: undefined,
    },
    i18n: { getMessage: () => '' }, // English fallbacks
    storage: {
        local: storageLocal,
        session: { get: jest.fn(async () => ({})) },
        onChanged: {
            addListener: jest.fn((l: any) => storageListeners.push(l)),
            removeListener: jest.fn(),
        },
    },
};

import { readFileSync } from 'fs';
import { join } from 'path';
import { PREFS_KEY } from '../src/prefs';
import { SUPPORTED_LANGUAGES, loadLanguagePrefs } from '../src/languages';

const SETTINGS_HTML = (() => {
    const file = readFileSync(join(__dirname, '../src/settings/settings.html'), 'utf8');
    const body = /<body>([\s\S]*?)<\/body>/.exec(file);
    if (!body) throw new Error('settings.html has no <body>');
    return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

let status: Record<string, unknown> = { signedIn: false, inboxCount: 0 };

beforeEach(() => {
    document.body.innerHTML = SETTINGS_HTML;
    document.title = '';
    storageListeners.length = 0;
    status = { signedIn: false, inboxCount: 0, localCount: 0, needsReauth: false };
    sendMessageMock.mockReset();
    sendMessageMock.mockImplementation((msg: any, cb: any) => {
        if (typeof cb !== 'function') return;
        if (msg?.action === 'AUTH_STATUS') cb(status);
        else if (msg?.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM') cb({ ok: true });
        else if (msg?.action === 'AUTH_SIGN_OUT') {
            status = { signedIn: false, inboxCount: 0, localCount: 0, needsReauth: false };
            cb({ ok: true });
        } else cb({});
    });
    for (const k of Object.keys(store)) delete store[k];
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
    jest.resetModules();
});

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function mount(edition: 'youtube' | 'rezka' = 'youtube', languages?: string[]): Promise<void> {
    const { initSettings } = await import('../src/settings/settings');
    initSettings({ edition, languages });
    await nextTick();
    await nextTick();
}

const page = (): HTMLElement => document.getElementById('page')!;
const box = (pref: string): HTMLInputElement => page().querySelector(`input[data-pref="${pref}"]`) as HTMLInputElement;
const button = (text: string): HTMLButtonElement => {
    const found = [...page().querySelectorAll('button')].filter((b) => b.textContent === text);
    if (found.length !== 1) throw new Error(`expected one button "${text}", found ${found.length}`);
    return found[0];
};
const flip = async (pref: string): Promise<void> => {
    box(pref).checked = !box(pref).checked;
    box(pref).dispatchEvent(new Event('change'));
    await nextTick();
};
const sentActions = (): unknown[] => sendMessageMock.mock.calls.map((c) => c[0]);

test('the settings page carries the mount point and loads its own bundle and styles', () => {
    const file = readFileSync(join(__dirname, '../src/settings/settings.html'), 'utf8');
    expect(document.getElementById('page')).not.toBeNull();
    expect(file).toContain('<script src="src/settings/settings.js"></script>');
    expect(file).toContain('href="src/popup/popup.css"');
    expect(file).toContain('href="src/pages/page.css"');
});

describe('the header and the groups', () => {
    test('titled "Settings", with a "My words" link to words.html', async () => {
        await mount();

        expect(page().querySelector('h1')!.textContent).toBe('Settings');
        expect(document.title).toBe('Settings');
        const link = page().querySelector('a.link') as HTMLAnchorElement;
        expect(link.textContent).toBe('My words');
        expect(link.getAttribute('href')).toBe('words.html');
    });

    test('five groups, labelled in this order', async () => {
        await mount();

        const labels = [...page().querySelectorAll('.group-label, .lang-settings-title')].map((n) => n.textContent);
        expect(labels).toEqual(['Languages', 'Where Lingogram works', 'Google Translate', 'Privacy', 'Account']);
    });
});

describe('languages', () => {
    const selects = (): HTMLSelectElement[] => [...page().querySelectorAll<HTMLSelectElement>('.lang-select')];
    const choose = async (select: HTMLSelectElement, value: string): Promise<void> => {
        select.value = value;
        select.dispatchEvent(new Event('change'));
        await nextTick();
        await nextTick();
    };

    test('two labelled pickers, each listing every supported language after the placeholder', async () => {
        await mount();

        expect([...page().querySelectorAll('.lang-select')].map((s) => s.closest('label')!.querySelector('.row-label')!.textContent)).toEqual([
            "I'm learning",
            'My native language',
        ]);
        expect(SUPPORTED_LANGUAGES).toHaveLength(42);
        for (const s of selects()) {
            expect(s.options).toHaveLength(43);
            expect(s.options[0].value).toBe('');
            expect(s.options[0].textContent).toBe('Select…');
        }
    });

    test('an option carries the English and the own name when they differ, and one name when they match', async () => {
        await mount();
        const byValue = new Map([...selects()[0].options].map((o) => [o.value, o.textContent]));
        const differing = SUPPORTED_LANGUAGES.find((l) => l.native !== l.label)!;
        const same = SUPPORTED_LANGUAGES.find((l) => l.native === l.label)!;

        expect(byValue.get(differing.code)).toBe(`${differing.label} — ${differing.native}`);
        expect(byValue.get(same.code)).toBe(same.label);
    });

    test('an edition limited to a few languages offers only those', async () => {
        await mount('rezka', ['en', 'ru']);
        for (const s of selects()) expect([...s.options].map((o) => o.value)).toEqual(['', 'en', 'ru']);
    });

    test('prefilled from what is stored', async () => {
        // Written through the module that owns the key, so the test does not guess it.
        const { saveLanguagePrefs } = await import('../src/languages');
        await saveLanguagePrefs({ learning: 'es', native: 'ru' });
        sendMessageMock.mockClear();
        await mount();

        expect(selects()[0].value).toBe('es');
        expect(selects()[1].value).toBe('ru');
    });

    test('nothing is stored until both are chosen', async () => {
        await mount();
        storageLocal.set.mockClear();
        sendMessageMock.mockClear();

        await choose(selects()[0], 'en');

        // Not "loads back as null": a half pair would also load back as null.
        expect(storageLocal.set).not.toHaveBeenCalled();
        expect(sentActions().filter((m: any) => m.action === 'TRACK_EVENT')).toEqual([]);
    });

    test('choosing the second stores the pair and reports where it was chosen', async () => {
        await mount();
        await choose(selects()[0], 'en');
        sendMessageMock.mockClear();

        await choose(selects()[1], 'ru');

        expect(await loadLanguagePrefs()).toEqual({ learning: 'en', native: 'ru' });
        const tracked = sentActions().filter((m: any) => m.action === 'TRACK_EVENT');
        expect(tracked).toEqual([
            { action: 'TRACK_EVENT', event: 'languages_configured', params: { learning: 'en', native: 'ru', via: 'popup' } },
        ]);
    });
});

describe('where Lingogram works', () => {
    test('the YouTube edition: a switch per site, then the highlight, in that order', async () => {
        await mount('youtube');

        const works = [...page().querySelectorAll('.group')][1];
        expect([...works.querySelectorAll('.row-label')].map((n) => n.textContent)).toEqual([
            'Subtitles on YouTube',
            'Subtitles on Netflix',
            'Highlight my words on websites',
        ]);
    });

    test('hints sit under YouTube and under the highlight, and nowhere else', async () => {
        await mount('youtube');

        const rows = [...page().querySelectorAll('.group')][1].querySelectorAll('.row');
        expect([...rows].map((r) => r.querySelector('.row-hint')?.textContent ?? null)).toEqual([
            'Dual subtitles and the word list next to the video.',
            null,
            'Words you saved are marked on any page you read. Point at one to see its translation.',
        ]);
    });

    test('a hint is the switch\'s accessible description', async () => {
        await mount('youtube');

        const hint = document.getElementById(box('pageHighlight').getAttribute('aria-describedby')!)!;
        expect(hint.textContent).toBe('Words you saved are marked on any page you read. Point at one to see its translation.');
    });

    test('a switch writes its pref', async () => {
        await mount('youtube');

        await flip('siteNetflix');
        await flip('pageHighlight');

        const stored = prefsOf();
        expect(stored.siteNetflix).toBe(false);
        expect(stored.pageHighlight).toBe(false);
        expect(stored.siteYoutube).not.toBe(false);
    });

    test('the reload line appears after a site change, and not after the highlight', async () => {
        await mount('youtube');
        expect(page().querySelector('.reload')).toBeNull();

        await flip('pageHighlight');
        expect(page().querySelector('.reload')).toBeNull();

        await flip('siteYoutube');
        const lines = page().querySelectorAll('.reload');
        expect(lines).toHaveLength(1);
        expect(lines[0].textContent).toBe('Reload the page to apply.');
    });
});

describe('where Lingogram works: the sites highlighting is off on', () => {
    const line = (): HTMLElement | null => page().querySelector('.off-hosts');
    const chips = (): string[] => [...page().querySelectorAll('.off-host')].map((c) => c.firstElementChild!.textContent!);
    const remove = (host: string): HTMLButtonElement =>
        page().querySelector(`button[aria-label="Highlight words on ${host} again"]`) as HTMLButtonElement;

    test('the HDrezka edition: HDrezka, then the highlight', async () => {
        await mount('rezka', ['en', 'ru']);

        const works = [...page().querySelectorAll('.group')][1];
        expect([...works.querySelectorAll('.row-label')].map((n) => n.textContent)).toEqual([
            'Subtitles on HDrezka',
            'Highlight my words on websites',
        ]);
    });

    test('with an empty list there is no line at all', async () => {
        await mount('youtube');

        expect(line()!.hidden).toBe(true);
        expect(page().textContent).not.toContain('Not highlighted on:');
        expect(page().querySelectorAll('.off-host')).toHaveLength(0);
    });

    test('lists each host after "Not highlighted on:", under the highlight row, inside the group', async () => {
        store[PREFS_KEY] = { highlightOffHosts: ['bbc.com', 'en.wikipedia.org'] };
        await mount('youtube');

        const works = [...page().querySelectorAll('.group')][1];
        expect(line()!.hidden).toBe(false);
        expect(line()!.parentElement).toBe(works);
        expect(line()!.previousElementSibling!.querySelector('input')!.getAttribute('data-pref')).toBe('pageHighlight');
        expect(line()!.firstChild!.textContent).toBe('Not highlighted on:');
        expect(chips()).toEqual(['bbc.com', 'en.wikipedia.org']);
    });

    test('each host has a remove control named for it', async () => {
        store[PREFS_KEY] = { highlightOffHosts: ['bbc.com', 'en.wikipedia.org'] };
        await mount('youtube');

        expect(remove('bbc.com').textContent).toBe('×');
        expect(remove('en.wikipedia.org').textContent).toBe('×');
    });

    test('removing one host takes out exactly that one', async () => {
        store[PREFS_KEY] = { highlightOffHosts: ['bbc.com', 'en.wikipedia.org', 'a.org'], siteNetflix: false };
        await mount('youtube');

        remove('en.wikipedia.org').click();
        await nextTick();
        await nextTick();

        expect(prefsOf().highlightOffHosts).toEqual(['bbc.com', 'a.org']);
        expect(prefsOf().siteNetflix).toBe(false);
        expect(chips()).toEqual(['bbc.com', 'a.org']);
    });

    test('removing the last host hides the line', async () => {
        store[PREFS_KEY] = { highlightOffHosts: ['bbc.com'] };
        await mount('youtube');

        remove('bbc.com').click();
        await nextTick();
        await nextTick();

        expect(prefsOf().highlightOffHosts).toEqual([]);
        expect(line()!.hidden).toBe(true);
        expect(page().textContent).not.toContain('Not highlighted on:');
    });

    test('follows the list when a popup changes it', async () => {
        await mount('youtube');
        expect(line()!.hidden).toBe(true);

        const next = { highlightOffHosts: ['theguardian.com'] };
        for (const l of storageListeners) l({ [PREFS_KEY]: { newValue: next } }, 'local');

        expect(line()!.hidden).toBe(false);
        expect(chips()).toEqual(['theguardian.com']);
    });

    test('garbage in storage shows no line', async () => {
        store[PREFS_KEY] = { highlightOffHosts: 'bbc.com' };
        await mount('youtube');

        expect(line()!.hidden).toBe(true);
    });
});

function prefsOf(): any {
    return store[PREFS_KEY];
}

describe('Google Translate import', () => {
    test('is on the page, signed in or out, and starts the import from its button', async () => {
        await mount();

        const block = page().querySelector('.gt-import')!;
        expect(block.querySelector('.lang-settings-title')!.textContent).toBe('Google Translate');
        sendMessageMock.mockClear();
        (block.querySelector('button') as HTMLButtonElement).click();
        expect(sentActions()).toEqual([{ action: 'GT_IMPORT_START' }]);
    });

    test('also when signed in', async () => {
        status = { signedIn: true, email: 'a@b.c', inboxCount: 3, localCount: 0, needsReauth: false };
        await mount();
        expect(page().querySelector('.gt-import button')!.textContent).toBe('Import from Google Translate');
    });
});

describe('privacy', () => {
    const analytics = (): HTMLInputElement => box('analyticsEnabled');

    test('the switch carries its hint, on by default', async () => {
        await mount();
        expect(analytics().checked).toBe(true);
        const hint = document.getElementById(analytics().getAttribute('aria-describedby')!)!;
        expect(hint.textContent).toBe(
            'Counts like “subtitles loaded” and “word saved”. Never your account, the videos you watch, or the words you save.',
        );
    });

    test('reads back a stored opt-out', async () => {
        store[PREFS_KEY] = { analyticsEnabled: false };
        await mount();
        expect(analytics().checked).toBe(false);
    });

    test('opting out sends the final event BEFORE the preference is touched', async () => {
        await mount();
        // Issue order is what counts: the worker gates the event on the stored
        // preference, so the event has to be on its way before the write starts.
        const order: string[] = [];
        const realGet = storageLocal.get.getMockImplementation()!;
        const realSet = storageLocal.set.getMockImplementation()!;
        storageLocal.get.mockImplementation((keys: any) => {
            if (keys === PREFS_KEY) order.push('prefs-read');
            return realGet(keys);
        });
        storageLocal.set.mockImplementation((items: Record<string, unknown>) => {
            if (PREFS_KEY in items) order.push(`prefs-write:${(items[PREFS_KEY] as any).analyticsEnabled}`);
            return realSet(items);
        });
        sendMessageMock.mockImplementation((msg: any, cb: any) => {
            if (msg?.action === 'TRACK_EVENT') order.push(`event:${msg.event}`);
            cb?.({});
        });
        try {
            analytics().checked = false;
            analytics().dispatchEvent(new Event('change'));
            await nextTick();
        } finally {
            storageLocal.get.mockImplementation(realGet);
            storageLocal.set.mockImplementation(realSet);
        }

        // The preference is read (more than once) and then written; the event
        // comes before the first of those and nothing else is reported.
        expect(order[0]).toBe('event:analytics_opt_out');
        expect(order.filter((x) => x.startsWith('event:'))).toHaveLength(1);
        expect(order[order.length - 1]).toBe('prefs-write:false');
    });

    test('opting back in writes and sends nothing', async () => {
        store[PREFS_KEY] = { analyticsEnabled: false };
        await mount();
        sendMessageMock.mockClear();

        analytics().checked = true;
        analytics().dispatchEvent(new Event('change'));
        await nextTick();

        expect(sentActions().filter((m: any) => m.action === 'TRACK_EVENT')).toEqual([]);
        expect(prefsOf().analyticsEnabled).toBe(true);
    });
});

describe('account', () => {
    const account = (): HTMLElement => [...page().querySelectorAll('.group')].pop() as HTMLElement;

    test('signed in: the email and a secondary "Sign out"', async () => {
        status = { signedIn: true, email: 'reader@example.com', uid: 'u1', inboxCount: 3, localCount: 0, needsReauth: false };
        await mount();

        expect(account().querySelector('.row-label')!.textContent).toBe('reader@example.com');
        const out = button('Sign out');
        expect(out.className).toBe('secondary');
        expect(account().querySelector('button.primary')).toBeNull();
    });

    test('signed in without an email on record', async () => {
        status = { signedIn: true, inboxCount: 3 };
        await mount();
        expect(account().querySelector('.row-label')!.textContent).toBe('(unknown email)');
    });

    test('"Sign out" signs out and the block turns into the signed-out one', async () => {
        status = { signedIn: true, email: 'reader@example.com', inboxCount: 3, localCount: 0, needsReauth: false };
        await mount();
        sendMessageMock.mockClear();

        button('Sign out').click();
        await nextTick();
        await nextTick();

        expect(sentActions()).toEqual([{ action: 'AUTH_SIGN_OUT' }, { action: 'AUTH_STATUS' }]);
        expect(account().querySelector('.row-label')!.textContent).toBe('Not signed in');
        expect(account().textContent).not.toContain('reader@example.com');
    });

    test('a sign-out that failed says so and keeps the account shown', async () => {
        status = { signedIn: true, email: 'reader@example.com', inboxCount: 3 };
        await mount();
        sendMessageMock.mockImplementation((msg: any, cb: any) => {
            if (msg?.action === 'AUTH_SIGN_OUT') {
                (chrome.runtime as any).lastError = { message: 'worker gone' };
                cb(undefined);
                (chrome.runtime as any).lastError = undefined;
            } else cb(status);
        });

        button('Sign out').click();
        await nextTick();
        await nextTick();

        expect(account().querySelector('.error')!.textContent).toBe('Error: worker gone');
        expect(account().querySelector('.row-label')!.textContent).toBe('reader@example.com');
        expect(button('Sign out').disabled).toBe(false);
    });

    test('signed out: "Not signed in", its hint and a primary "Sign in on Lingogram"', async () => {
        await mount();

        expect(account().querySelector('.row-label')!.textContent).toBe('Not signed in');
        expect(account().querySelector('.row-hint')!.textContent).toBe(
            'Your words are kept in this browser. Sign in to keep them on every device.',
        );
        expect(button('Sign in on Lingogram').className).toBe('primary');
        expect(account().querySelector('button.secondary')).toBeNull();
    });

    test('that button starts the sign-in from the settings page', async () => {
        await mount();
        sendMessageMock.mockClear();

        button('Sign in on Lingogram').click();
        await nextTick();

        expect(sentActions()).toEqual([{ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'settings' }]);
    });

    test('an expired session: "You were signed out" and a primary "Sign in again"', async () => {
        status = { signedIn: false, inboxCount: 2, localCount: 2, needsReauth: true };
        await mount();

        expect(account().querySelector('.row-label')!.textContent).toBe('You were signed out');
        expect(account().querySelector('.row-hint')!.textContent).toBe('Sign in again to keep saving words.');
        expect(button('Sign in again').className).toBe('primary');
    });

    test('"Sign in again" starts the sign-in from the settings page', async () => {
        status = { signedIn: false, inboxCount: 2, localCount: 2, needsReauth: true };
        await mount();
        sendMessageMock.mockClear();

        button('Sign in again').click();
        await nextTick();

        expect(sentActions()).toEqual([{ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'settings' }]);
    });

    test('a refused sign-in shows the reason and lets the learner try again', async () => {
        await mount();
        sendMessageMock.mockImplementation((msg: any, cb: any) =>
            cb(msg?.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: false, error: 'tab refused' } : status),
        );

        button('Sign in on Lingogram').click();
        await nextTick();

        expect(account().querySelector('.error')!.textContent).toBe('Error: tab refused');
        expect(button('Sign in on Lingogram').disabled).toBe(false);
    });

    test('follows a sign-in made in another tab, without a reload', async () => {
        await mount();
        expect(account().querySelector('.row-label')!.textContent).toBe('Not signed in');

        status = { signedIn: true, email: 'new@example.com', inboxCount: 1, localCount: 0, needsReauth: false };
        for (const l of storageListeners) l({ 'auth.email': { newValue: 'new@example.com' } }, 'local');
        await nextTick();
        await nextTick();

        expect(account().querySelector('.row-label')!.textContent).toBe('new@example.com');
    });

    test('ignores storage changes that are not about the account', async () => {
        await mount();
        sendMessageMock.mockClear();

        for (const l of storageListeners) l({ 'prefs.v1': { newValue: {} } }, 'local');
        for (const l of storageListeners) l({ 'auth.email': { newValue: 'x' } }, 'session');
        await nextTick();

        expect(sentActions()).toEqual([]);
    });
});
