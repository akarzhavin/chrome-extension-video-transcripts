/**
 * @jest-environment jsdom
 */

/**
 * The toolbar popup: a header, one state block (four of them), the per-site
 * highlight switch, a hairline and a "Settings" link. The language pickers, the Google Translate
 * import, the privacy switch and the sign-out button are on the settings page
 * now (settings-page.test.ts).
 *
 * The page is loaded from popup.html rather than hand-written, so a mount point
 * renamed there fails here rather than in the field: the popup renders into
 * #root and finds nothing to render into if that id moves.
 */

const sendMessageMock = jest.fn();
const openOptionsPageMock = jest.fn();
const tabsCreateMock = jest.fn();
const tabsQueryMock = jest.fn();

const prefsStore: Record<string, unknown> = {};
const storageLocal = {
    get: jest.fn((keys: string | string[] | null) => {
        if (keys == null) return Promise.resolve({ ...prefsStore });
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in prefsStore) out[k] = prefsStore[k];
        return Promise.resolve(out);
    }),
    set: jest.fn((items: Record<string, unknown>) => {
        Object.assign(prefsStore, items);
        return Promise.resolve();
    }),
};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        getURL: (p: string) => `chrome-extension://test-extension-id/${p}`,
        sendMessage: sendMessageMock,
        openOptionsPage: openOptionsPageMock,
        lastError: undefined,
    },
    tabs: { create: tabsCreateMock, query: tabsQueryMock },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' }, // English fallbacks
    storage: { local: storageLocal, onChanged: { addListener: jest.fn() } },
};

import { readFileSync } from 'fs';
import { join } from 'path';
import { PREFS_KEY } from '../src/prefs';

/**
 * The popup's own markup. Only the body is taken: jsdom already owns the
 * document, and the <script> tag would try to fetch a build artefact.
 */
const POPUP_HTML = (() => {
    const file = readFileSync(join(__dirname, '../src/popup/popup.html'), 'utf8');
    const body = /<body>([\s\S]*?)<\/body>/.exec(file);
    if (!body) throw new Error('popup.html has no <body>');
    return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

beforeEach(() => {
    document.body.innerHTML = POPUP_HTML;
    sendMessageMock.mockReset();
    openOptionsPageMock.mockReset().mockResolvedValue(undefined);
    tabsCreateMock.mockReset().mockResolvedValue({});
    tabsQueryMock.mockReset().mockResolvedValue([]);
    window.close = jest.fn();
    for (const k of Object.keys(prefsStore)) delete prefsStore[k];
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
    jest.resetModules();
});

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Answer AUTH_STATUS with the given status; everything else resolves empty. */
function withStatus(status: Record<string, unknown>): void {
    sendMessageMock.mockImplementation((msg: any, cb: any) => {
        if (typeof cb !== 'function') return;
        cb(msg?.action === 'AUTH_STATUS' ? status : {});
    });
}

/** The tab the popup was opened on. */
function onTab(url: string): void {
    tabsQueryMock.mockResolvedValue([{ id: 1, url }]);
}

/** Mount the popup and let its async prefills settle. */
async function mount(edition?: 'youtube' | 'rezka'): Promise<void> {
    const { initPopup } = await import('../src/popup/popup');
    initPopup(edition ? { edition } : undefined);
    await nextTick();
}

const root = (): HTMLElement => document.getElementById('root')!;
const buttons = (): HTMLButtonElement[] => [...root().querySelectorAll('button')];
const buttonByText = (text: string): HTMLButtonElement => {
    const found = buttons().filter((b) => b.textContent === text);
    if (found.length !== 1) throw new Error(`expected one button "${text}", found ${found.length}`);
    return found[0];
};
const click = async (b: HTMLElement): Promise<void> => {
    b.click();
    await nextTick();
    await nextTick();
};

// The mount point is the contract between the html and the module. Asserted
// once, up front, so every check below is known to be running against the real
// page rather than an empty body that quietly renders nothing.
test('the popup page carries the mount point the module renders into', () => {
    expect(document.getElementById('root')).not.toBeNull();
});


describe("the popup's loading text", () => {
    // The status answer comes from the worker, which may be asleep, so there is a
    // real moment with no answer yet. Skipping the loading state renders the
    // signed-OUT card in that gap, which tells a signed-in user to sign in.
    test('it says it is loading before the status answers', async () => {
        // Deliberately never calls back: the state between opening the popup and
        // the worker replying.
        sendMessageMock.mockImplementation(() => {});
        const { initPopup } = await import('../src/popup/popup');
        initPopup();

        expect(root().textContent).toContain('Loading…');
    });

    test('it shows no card and no sign-in while still loading', async () => {
        sendMessageMock.mockImplementation(() => {});
        const { initPopup } = await import('../src/popup/popup');
        initPopup();

        expect(root().querySelector('.hero')).toBeNull();
        expect(root().textContent).not.toContain('Sign in');
        expect(root().textContent).not.toContain('Save words as you watch');
    });

    test('a worker that cannot be reached shows the error under the usual layout', async () => {
        sendMessageMock.mockImplementation((_m: any, cb: any) => {
            (chrome.runtime as any).lastError = { message: 'no receiving end' };
            cb(undefined);
            (chrome.runtime as any).lastError = undefined;
        });
        await mount();

        expect(root().querySelector('.error')!.textContent).toBe('Error: no receiving end');
        expect(root().textContent).toContain('Settings');
    });
});

describe('the header', () => {
    test('is the extension icon and the name', async () => {
        withStatus({ signedIn: false, inboxCount: 0 });
        await mount();

        const h1 = root().querySelector('h1')!;
        expect(h1.textContent).toBe('Lingogram');
        expect(h1.querySelector('img')!.getAttribute('src')).toBe('src/assets/icons/icon48.png');
    });
});

describe('state 1: signed out, nothing saved yet', () => {
    beforeEach(() => withStatus({ signedIn: false, inboxCount: 0, localCount: 0, needsReauth: false }));

    test('teaches the one gesture in a card', async () => {
        await mount();

        const card = root().querySelector('.hero')!;
        expect(card.querySelector('.hero-title')!.textContent).toBe('Save words as you watch');
        expect(card.textContent).toContain('Click a word in the subtitles, then Save. It is kept here, in this browser.');
    });

    test('has no primary button and no figure', async () => {
        await mount();

        expect(root().querySelector('button.primary')).toBeNull();
        expect(root().querySelector('.big')).toBeNull();
    });

    test('offers a quiet "Sign in on Lingogram" that starts the sign-in from the popup', async () => {
        await mount();
        sendMessageMock.mockClear();
        withStatus({ signedIn: false, inboxCount: 0 });
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        await click(buttonByText('Sign in on Lingogram'));

        expect(sendMessageMock.mock.calls.map((c) => c[0])).toEqual([
            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'popup' },
        ]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('a sign-in the worker refused stays open and says why', async () => {
        await mount();
        sendMessageMock.mockImplementation((m: any, cb: any) =>
            cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: false, error: 'tab refused' } : { signedIn: false, inboxCount: 0 }),
        );

        await click(buttonByText('Sign in on Lingogram'));

        expect(root().querySelector('.error')!.textContent).toBe('Error: tab refused');
        expect(window.close).not.toHaveBeenCalled();
        // the card is still there under the error
        expect(root().querySelector('.hero-title')!.textContent).toBe('Save words as you watch');
    });
});

describe('state 2: signed out, words kept on this device', () => {
    beforeEach(() => withStatus({ signedIn: false, inboxCount: 12, localCount: 12, needsReauth: false }));

    test('shows the count, what it counts, and one primary button', async () => {
        await mount();

        const card = root().querySelector('.hero')!;
        expect(card.querySelector('.big')!.textContent).toBe('12');
        expect(card.textContent).toContain('words saved on this device');
        expect(root().querySelectorAll('button.primary')).toHaveLength(1);
        expect(card.querySelector('button.primary')!.textContent).toBe('Open my words');
    });

    test('"Open my words" opens words.html in a tab and closes the popup', async () => {
        await mount();

        await click(buttonByText('Open my words'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/words.html' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('below it, a "Sign in" link and the reason as plain text', async () => {
        await mount();

        const line = [...root().querySelectorAll('.sm')].find((n) => n.textContent === 'Sign in to keep them on every device.')!;
        expect(line.querySelector('button')!.textContent).toBe('Sign in');
        expect(line.querySelector('span')!.textContent).toBe('to keep them on every device.');
    });

    test('that link starts the sign-in from the popup', async () => {
        await mount();
        sendMessageMock.mockClear();
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        await click(buttonByText('Sign in'));

        expect(sendMessageMock.mock.calls.map((c) => c[0])).toEqual([
            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'popup' },
        ]);
    });

    test('shows no account words button', async () => {
        await mount();
        expect(buttons().map((b) => b.textContent)).not.toContain('Open my vocabulary');
    });
});

describe('state 3: signed in', () => {
    beforeEach(() =>
        withStatus({ signedIn: true, email: 'reader@example.com', uid: 'u1', inboxCount: 387, localCount: 0, needsReauth: false }),
    );

    test("shows the account's count and one primary button", async () => {
        await mount();

        const card = root().querySelector('.hero')!;
        expect(card.querySelector('.big')!.textContent).toBe('387');
        expect(card.textContent).toContain('words saved');
        expect(card.textContent).not.toContain('on this device');
        expect(card.querySelector('button.primary')!.textContent).toBe('Open my vocabulary');
    });

    test('"Open my vocabulary" opens the site vocabulary in a tab and closes the popup', async () => {
        await mount();

        await click(buttonByText('Open my vocabulary'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'http://localhost:5173/app/vocab' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('no email, no sign-out button, no sign-in link in the popup', async () => {
        await mount();

        expect(root().textContent).not.toContain('reader@example.com');
        expect(buttons().map((b) => b.textContent)).not.toContain('Sign out');
        expect(root().textContent).not.toContain('Sign in');
    });

    // The count is a number the learner can read even when nothing is saved yet.
    test('an account with nothing saved reads zero', async () => {
        withStatus({ signedIn: true, email: 'reader@example.com' });
        await mount();
        expect(root().querySelector('.big')!.textContent).toBe('0');
    });
});

describe('state 4: the session expired', () => {
    const expired = (localCount: number) =>
        withStatus({ signedIn: false, inboxCount: localCount, localCount, needsReauth: true });

    test('says what the red "!" means, with one primary "Sign in again"', async () => {
        expired(3);
        await mount();

        const notice = root().querySelector('.warn')!;
        expect(notice.textContent).toContain('You were signed out. New words are kept on this device until you sign in again.');
        expect(notice.querySelector('button.primary')!.textContent).toBe('Sign in again');
        expect(root().querySelectorAll('button.primary')).toHaveLength(1);
    });

    test('"Sign in again" starts the sign-in from the popup', async () => {
        expired(3);
        await mount();
        sendMessageMock.mockClear();
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        await click(buttonByText('Sign in again'));

        expect(sendMessageMock.mock.calls.map((c) => c[0])).toEqual([
            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'popup' },
        ]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('words waiting here are a card with a secondary "Open my words"', async () => {
        expired(3);
        await mount();

        const card = root().querySelector('.hero')!;
        expect(card.querySelector('.big')!.textContent).toBe('3');
        expect(card.textContent).toContain('words waiting on this device');
        const open = card.querySelector('button')!;
        expect(open.textContent).toBe('Open my words');
        expect(open.className).toContain('secondary');
        expect(open.className).not.toContain('primary');
    });

    test('that button opens words.html in a tab and closes the popup', async () => {
        expired(3);
        await mount();

        await click(buttonByText('Open my words'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/words.html' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('with no words waiting there is no card, only the notice', async () => {
        expired(0);
        await mount();

        expect(root().querySelector('.warn')).not.toBeNull();
        expect(root().querySelector('.hero')).toBeNull();
        expect(root().textContent).not.toContain('Open my words');
    });

    test('a signed-in account is never shown the notice, whatever the stored flag says', async () => {
        withStatus({ signedIn: true, email: 'a@b.c', inboxCount: 4, localCount: 0, needsReauth: true });
        await mount();

        expect(root().querySelector('.warn')).toBeNull();
        expect(root().querySelector('.big')!.textContent).toBe('4');
    });
});

describe('what left the popup', () => {
    test('no language pickers, import block, privacy switch, sign-out or headings', async () => {
        withStatus({ signedIn: true, email: 'reader@example.com', inboxCount: 5 });
        await mount('youtube');

        expect(root().querySelector('select')).toBeNull();
        expect(root().querySelector('input[data-pref="analyticsEnabled"]')).toBeNull();
        expect(root().querySelector('.gt-import')).toBeNull();
        expect(root().querySelector('.lang-settings-title')).toBeNull();
        expect(buttons().map((b) => b.textContent)).not.toContain('Sign out');
        expect(root().textContent).not.toContain('Privacy');
        expect(root().textContent).not.toContain('Languages');
    });
});

describe('the per-site highlight switch', () => {
    const site = (): HTMLInputElement => root().querySelector('.switches input') as HTMLInputElement;
    const label = (): string => root().querySelector('.switches .row-label')!.textContent!;
    const offHosts = (): unknown => (prefsStore[PREFS_KEY] as any)?.highlightOffHosts;
    const flip = async (): Promise<void> => {
        site().checked = !site().checked;
        site().dispatchEvent(new Event('change'));
        await nextTick();
        await nextTick();
    };

    beforeEach(() => {
        withStatus({ signedIn: false, inboxCount: 0 });
        onTab('https://en.wikipedia.org/wiki/Cat');
    });

    test('is the only switch: the video-site and global ones are on the settings page', async () => {
        await mount('youtube');

        expect([...root().querySelectorAll('input')].map((i) => (i as HTMLElement).dataset.pref)).toEqual(['highlightOffHosts']);
        expect(root().querySelector('input[data-pref="siteYoutube"]')).toBeNull();
        expect(root().querySelector('input[data-pref="siteNetflix"]')).toBeNull();
        expect(root().querySelector('input[data-pref="pageHighlight"]')).toBeNull();
        expect(root().textContent).not.toContain('Subtitles on');
    });

    test('is a real accessible switch named by its visible text', async () => {
        await mount('youtube');

        expect(site().type).toBe('checkbox');
        expect(site().getAttribute('role')).toBe('switch');
        expect(document.getElementById(site().getAttribute('aria-labelledby')!)!.textContent).toBe(
            'Highlight words on en.wikipedia.org',
        );
    });

    test('names the tab\'s host without a leading www.', async () => {
        onTab('https://www.theguardian.com/uk');
        await mount('youtube');

        expect(label()).toBe('Highlight words on theguardian.com');
        expect(root().querySelector('.switches .host')!.textContent).toBe('theguardian.com');
    });

    test('keeps the host in its own element, so a long one can be cut with an ellipsis', async () => {
        const long = 'a-very-long-subdomain-name.another-long-label.example-organisation.co.uk';
        onTab(`https://${long}/`);
        await mount('youtube');

        const host = root().querySelector('.switches .host') as HTMLElement;
        expect(host.textContent).toBe(long);
        expect(host.title).toBe(long);
        expect(root().querySelector('.switches input')).not.toBeNull();
    });

    test('is on for a site that was never switched off, and writes nothing by itself', async () => {
        await mount('youtube');

        expect(site().checked).toBe(true);
        expect(site().disabled).toBe(false);
        expect(root().querySelector('.row-hint')).toBeNull();
        expect(prefsStore[PREFS_KEY]).toBeUndefined();
    });

    test('is off for a listed host, whichever way the tab spells it', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['theguardian.com'] };
        onTab('https://www.theguardian.com/uk');
        await mount('youtube');

        expect(site().checked).toBe(false);
    });

    test('turning it off lists the normalised host', async () => {
        onTab('https://www.theguardian.com/uk');
        await mount('youtube');

        await flip();

        expect(offHosts()).toEqual(['theguardian.com']);
    });

    test('turning it off keeps the hosts already listed', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['bbc.com'] };
        await mount('youtube');

        await flip();

        expect(offHosts()).toEqual(['bbc.com', 'en.wikipedia.org']);
    });

    test('turning it back on removes exactly that host', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['bbc.com', 'en.wikipedia.org', 'a.org'] };
        await mount('youtube');
        expect(site().checked).toBe(false);

        await flip();

        expect(offHosts()).toEqual(['bbc.com', 'a.org']);
    });

    test('a switch for a site leaves the other prefs alone', async () => {
        prefsStore[PREFS_KEY] = { siteNetflix: false, pageHighlight: true };
        await mount('youtube');

        await flip();

        expect((prefsStore[PREFS_KEY] as any).siteNetflix).toBe(false);
        expect((prefsStore[PREFS_KEY] as any).pageHighlight).toBe(true);
    });

    test('asks for the active tab of the current window', async () => {
        await mount('youtube');

        expect(tabsQueryMock.mock.calls).toEqual([[{ active: true, currentWindow: true }]]);
    });

    test('the switch slot is out of the layout until the tab answers', async () => {
        tabsQueryMock.mockReturnValue(new Promise(() => {}));
        await mount('youtube');

        expect((root().querySelector('.switches') as HTMLElement).hidden).toBe(true);
        expect(root().querySelector('.switches input')).toBeNull();
    });

    describe.each([
        ['a new tab', 'chrome://newtab/'],
        ['a chrome:// page', 'chrome://extensions/'],
        ["the extension's own page", 'chrome-extension://test-extension-id/words.html'],
        ['a local file', 'file:///Users/me/a.html'],
        ["Lingogram's own site", 'https://lingogram.ai/app/vocab'],
        ["a Lingogram subdomain", 'https://app.lingogram.ai/'],
    ])('on %s', (_name, url) => {
        test('there is no row at all, and no hint', async () => {
            onTab(url);
            await mount('youtube');

            expect(root().querySelector('.switches input')).toBeNull();
            expect(root().querySelector('.switches .row')).toBeNull();
            expect((root().querySelector('.switches') as HTMLElement).hidden).toBe(true);
            expect(root().textContent).not.toContain('Highlight words on');
            expect(root().textContent).not.toContain('Highlighting is off');
        });
    });

    test('with no tab URL (not exposed to the popup) there is no row', async () => {
        tabsQueryMock.mockResolvedValue([{ id: 4 }]);
        await mount('youtube');

        expect(root().querySelector('.switches input')).toBeNull();
        expect(root().textContent).not.toContain('Highlight words on');
    });

    test('with no tab at all, or a failing query, there is no row', async () => {
        tabsQueryMock.mockResolvedValue([]);
        await mount('youtube');
        expect(root().querySelector('.switches input')).toBeNull();

        document.body.innerHTML = POPUP_HTML;
        jest.resetModules();
        tabsQueryMock.mockRejectedValue(new Error('no'));
        await mount('youtube');
        expect(root().querySelector('.switches input')).toBeNull();
    });

    describe('with highlighting off on all websites', () => {
        beforeEach(() => {
            prefsStore[PREFS_KEY] = { pageHighlight: false, highlightOffHosts: [] };
        });

        test('the row stays, disabled and off, and says why under it', async () => {
            await mount('youtube');

            expect(label()).toBe('Highlight words on en.wikipedia.org');
            expect(site().disabled).toBe(true);
            expect(site().checked).toBe(false);
            const hint = document.getElementById(site().getAttribute('aria-describedby')!)!;
            expect(hint.textContent).toBe('Highlighting is off on all websites. Turn it on in Settings.');
            expect(root().querySelector('.row-hint')).toBe(hint);
        });

        test('"Settings" in the hint is not a link of its own', async () => {
            await mount('youtube');

            expect(buttons().filter((b) => b.textContent === 'Settings')).toHaveLength(1);
            expect(root().querySelector('.row-hint a, .row-hint button')).toBeNull();
        });

        test('even a listed host shows off, and a click changes nothing', async () => {
            prefsStore[PREFS_KEY] = { pageHighlight: false, highlightOffHosts: ['bbc.com'] };
            onTab('https://bbc.com/');
            await mount('youtube');

            site().click();
            await nextTick();
            await nextTick();

            expect(site().checked).toBe(false);
            expect(offHosts()).toEqual(['bbc.com']);
        });
    });
});

describe('the Settings link', () => {
    test('signed out: opens the extension settings page and closes the popup', async () => {
        withStatus({ signedIn: false, inboxCount: 0 });
        await mount('youtube');

        await click(buttonByText('Settings'));

        expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
        expect(tabsCreateMock).not.toHaveBeenCalled();
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('signed out, with no options page API: falls back to a tab on settings.html', async () => {
        withStatus({ signedIn: false, inboxCount: 0 });
        await mount('youtube');
        openOptionsPageMock.mockRejectedValue(new Error('unavailable'));

        await click(buttonByText('Settings'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/settings.html' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('expired session counts as signed out', async () => {
        withStatus({ signedIn: false, inboxCount: 2, localCount: 2, needsReauth: true });
        await mount('youtube');

        await click(buttonByText('Settings'));

        expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
        expect(tabsCreateMock).not.toHaveBeenCalled();
    });

    test("signed in: opens the site's page for this extension and edition, and closes the popup", async () => {
        withStatus({ signedIn: true, email: 'a@b.c', inboxCount: 1 });
        await mount('youtube');

        await click(buttonByText('Settings'));

        expect(tabsCreateMock.mock.calls).toEqual([
            [{ url: 'http://localhost:5173/app/vocab/extension?ext=test-extension-id&edition=youtube' }],
        ]);
        expect(openOptionsPageMock).not.toHaveBeenCalled();
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('signed in on the HDrezka edition names that edition', async () => {
        withStatus({ signedIn: true, email: 'a@b.c', inboxCount: 1 });
        await mount('rezka');

        await click(buttonByText('Settings'));

        expect(tabsCreateMock.mock.calls).toEqual([
            [{ url: 'http://localhost:5173/app/vocab/extension?ext=test-extension-id&edition=rezka' }],
        ]);
    });

    test('sits last, under a hairline', async () => {
        withStatus({ signedIn: false, inboxCount: 0 });
        await mount('youtube');

        const kids = [...root().children];
        expect(kids[kids.length - 1].textContent).toBe('Settings');
        expect(kids[kids.length - 2].tagName).toBe('HR');
    });
});
