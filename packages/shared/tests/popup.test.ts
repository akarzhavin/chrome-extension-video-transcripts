/**
 * @jest-environment jsdom
 */

/**
 * The toolbar popup: a plain menu. A header, the account rows (four states),
 * the per-site highlight row, one separator and the "Settings" row. The language pickers, the Google Translate
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
/**
 * What the learner sees below the header, top to bottom, one string per row:
 * a row's label and its value in brackets, a block's text, a sub-line, and
 * "---" for the separator. Slots that are still hidden are left out.
 */
const visibleRows = (): string[] =>
    [...root().querySelectorAll('.mi, .mintro, .mnote, .msub, .msep')]
        .filter((n) => !n.closest('[hidden]'))
        .map((n) => {
            if (n.classList.contains('msep')) return '---';
            if (!n.classList.contains('mi')) return n.textContent!.trim();
            const value = n.querySelector('.v2');
            return n.querySelector('.l')!.textContent + (value ? ` [${value.textContent}]` : '');
        });
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

    test('it shows no rows and no sign-in while still loading', async () => {
        sendMessageMock.mockImplementation(() => {});
        const { initPopup } = await import('../src/popup/popup');
        initPopup();

        expect(root().querySelector('.mintro')).toBeNull();
        expect(root().querySelector('.mi')).toBeNull();
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
        expect(h1.className).toBe('mhd');
        expect(h1.querySelector('img')!.getAttribute('src')).toBe('src/assets/icons/icon48.png');
        expect(h1.querySelector('img')!.getAttribute('width')).toBe('18');
        expect(root().firstElementChild).toBe(h1);
    });
});

describe('state 1: signed out, nothing saved yet', () => {
    beforeEach(() => withStatus({ signedIn: false, inboxCount: 0, localCount: 0, needsReauth: false }));

    test('shows exactly these rows, in this order', async () => {
        await mount();

        expect(visibleRows()).toEqual([
            'Save words as you watch' + 'Click a word in the subtitles, then Save. It is kept here, in this browser.',
            'Sign in on Lingogram',
            '---',
            'Settings',
        ]);
    });

    test('teaches the one gesture in a soft block', async () => {
        await mount();

        const block = root().querySelector('.mintro')!;
        expect(block.querySelector('b')!.textContent).toBe('Save words as you watch');
        expect(block.querySelector('span')!.textContent).toBe('Click a word in the subtitles, then Save. It is kept here, in this browser.');
    });

    test('has no figure and no count', async () => {
        await mount();

        expect(root().querySelector('.v2')).toBeNull();
        expect(root().querySelector('.chev')).toBeNull();
    });

    test('"Sign in on Lingogram" is an accent row that starts the sign-in from the popup', async () => {
        await mount();
        sendMessageMock.mockClear();
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        const row = buttonByText('Sign in on Lingogram');
        expect(row.querySelector('.l')!.className).toBe('l acc');
        await click(row);

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
        // the block is still there under the error
        expect(root().querySelector('.mintro b')!.textContent).toBe('Save words as you watch');
    });
});

describe('state 2: signed out, words kept on this device', () => {
    beforeEach(() => withStatus({ signedIn: false, inboxCount: 12, localCount: 12, needsReauth: false }));

    test('shows exactly these rows, in this order', async () => {
        await mount();

        expect(visibleRows()).toEqual(['My words [12]', 'Sign in to keep them on every device.', '---', 'Settings']);
    });

    test('"My words" carries the count and a chevron, and is a button', async () => {
        await mount();

        const row = buttonByText('My words12');
        expect(row.querySelector('.v2')!.textContent).toBe('12');
        expect(row.querySelector('svg.chev')).not.toBeNull();
    });

    test('"My words" opens words.html in a tab and closes the popup', async () => {
        await mount();

        await click(buttonByText('My words12'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/words.html' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('the sign-in row is "Sign in" in the accent colour and the reason in normal text', async () => {
        await mount();

        const row = [...root().querySelectorAll('button.mi')].find((b) => b.textContent === 'Sign in to keep them on every device.')!;
        expect(row.querySelector('.acc')!.textContent).toBe('Sign in');
        expect(row.querySelector('.l')!.className).toBe('l');
        expect(row.querySelector('svg')).not.toBeNull();
    });

    test('that row starts the sign-in from the popup', async () => {
        await mount();
        sendMessageMock.mockClear();
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        await click(buttonByText('Sign in to keep them on every device.'));

        expect(sendMessageMock.mock.calls.map((c) => c[0])).toEqual([
            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'popup' },
        ]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('shows no account vocabulary row', async () => {
        await mount();
        expect(buttons().map((b) => b.textContent)).not.toContain('My vocabulary12');
        expect(root().textContent).not.toContain('My vocabulary');
    });
});

describe('state 3: signed in', () => {
    beforeEach(() =>
        withStatus({ signedIn: true, email: 'reader@example.com', uid: 'u1', inboxCount: 387, localCount: 0, needsReauth: false }),
    );

    test('shows exactly these rows, in this order', async () => {
        await mount();

        expect(visibleRows()).toEqual(['My vocabulary [387]', '---', 'Settings']);
    });

    test('"My vocabulary" opens the site vocabulary in a tab and closes the popup', async () => {
        await mount();

        await click(buttonByText('My vocabulary387'));

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'http://localhost:5173/app/vocab' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('no email, no sign-out button, no sign-in row in the popup', async () => {
        await mount();

        expect(root().textContent).not.toContain('reader@example.com');
        expect(buttons().map((b) => b.textContent)).not.toContain('Sign out');
        expect(root().textContent).not.toContain('Sign in');
    });

    // The count is a number the learner can read even when nothing is saved yet.
    test('an account with nothing saved reads zero', async () => {
        withStatus({ signedIn: true, email: 'reader@example.com' });
        await mount();
        expect(visibleRows()).toEqual(['My vocabulary [0]', '---', 'Settings']);
    });
});

describe('state 4: the session expired', () => {
    const expired = (localCount: number) =>
        withStatus({ signedIn: false, inboxCount: localCount, localCount, needsReauth: true });

    test('shows exactly these rows, in this order', async () => {
        expired(3);
        await mount();

        expect(visibleRows()).toEqual([
            'You were signed out. New words are kept on this device until you sign in again.',
            'Sign in again',
            'Words waiting on this device [3]',
            '---',
            'Settings',
        ]);
    });

    test('with no words waiting there is only the notice and "Sign in again"', async () => {
        expired(0);
        await mount();

        expect(visibleRows()).toEqual([
            'You were signed out. New words are kept on this device until you sign in again.',
            'Sign in again',
            '---',
            'Settings',
        ]);
    });

    test('"Sign in again" is an accent row that starts the sign-in from the popup', async () => {
        expired(3);
        await mount();
        sendMessageMock.mockClear();
        sendMessageMock.mockImplementation((m: any, cb: any) => cb(m.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM' ? { ok: true } : {}));

        const row = buttonByText('Sign in again');
        expect(row.querySelector('.l')!.className).toBe('l acc');
        await click(row);

        expect(sendMessageMock.mock.calls.map((c) => c[0])).toEqual([
            { action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'popup' },
        ]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('"Words waiting on this device" opens words.html in a tab and closes the popup', async () => {
        expired(3);
        await mount();

        const row = buttonByText('Words waiting on this device3');
        expect(row.querySelector('svg.chev')).not.toBeNull();
        await click(row);

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/words.html' }]]);
        expect(window.close).toHaveBeenCalledTimes(1);
    });

    test('a signed-in account is never shown the notice, whatever the stored flag says', async () => {
        withStatus({ signedIn: true, email: 'a@b.c', inboxCount: 4, localCount: 0, needsReauth: true });
        await mount();

        expect(root().querySelector('.mnote')).toBeNull();
        expect(visibleRows()).toEqual(['My vocabulary [4]', '---', 'Settings']);
    });
});

describe('the rows are real controls', () => {
    test('every acting row is a <button type="button"> with its text as the accessible name', async () => {
        withStatus({ signedIn: false, inboxCount: 12, localCount: 12, needsReauth: false });
        await mount('youtube');

        const rows = [...root().querySelectorAll('.mi')].filter((r) => !r.classList.contains('static'));
        expect(rows.map((r) => r.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON']);
        expect(rows.map((r) => (r as HTMLButtonElement).type)).toEqual(['button', 'button', 'button', 'button']);
        expect(rows.map((r) => r.textContent)).toEqual([
            'My words12',
            'Sign in to keep them on every device.',
            'Finish setup',
            'Settings',
        ]);
    });

    test('every row has a stroke icon hidden from the accessibility tree', async () => {
        withStatus({ signedIn: true, inboxCount: 3 });
        await mount('youtube');

        const icons = [...root().querySelectorAll('.mi > svg:first-child')];
        // vocabulary, finish setup, settings
        expect(icons).toHaveLength(3);
        expect(icons.map((i) => i.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true']);
        expect(icons.map((i) => i.getAttribute('stroke'))).toEqual(['currentColor', 'currentColor', 'currentColor']);
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
    const site = (): HTMLInputElement => root().querySelector('.highlight input') as HTMLInputElement;
    const label = (): string => root().querySelector('.highlight .l')!.textContent!;
    const sub = (): HTMLElement | null => root().querySelector('.highlight .msub');
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

    test('sits between the account rows and the separator, as a pen row with its switch', async () => {
        await mount('youtube');

        expect(visibleRows()).toEqual([
            'Save words as you watchClick a word in the subtitles, then Save. It is kept here, in this browser.',
            'Sign in on Lingogram',
            'Finish setup',
            'Highlight on en.wikipedia.org',
            '---',
            'Settings',
        ]);
        const row = root().querySelector('.highlight .mi')!;
        expect(row.classList.contains('static')).toBe(true);
        expect(row.querySelector('svg')).not.toBeNull();
        expect(row.lastElementChild!.className).toBe('sw');
    });

    test('is the only switch: the video-site and global ones are on the settings page', async () => {
        await mount('youtube');

        expect([...root().querySelectorAll('input')].map((i) => (i as HTMLElement).dataset.pref)).toEqual(['highlightOffHosts']);
        expect(root().querySelector('input[data-pref="siteYoutube"]')).toBeNull();
        expect(root().querySelector('input[data-pref="siteNetflix"]')).toBeNull();
        expect(root().querySelector('input[data-pref="pageHighlight"]')).toBeNull();
        expect(root().textContent).not.toContain('Subtitles on');
    });

    test('is a real accessible switch whose name contains the host', async () => {
        await mount('youtube');

        expect(site().type).toBe('checkbox');
        expect(site().getAttribute('role')).toBe('switch');
        expect(document.getElementById(site().getAttribute('aria-labelledby')!)!.textContent).toBe('Highlight on en.wikipedia.org');
    });

    test('names the tab\'s host without a leading www.', async () => {
        onTab('https://www.theguardian.com/uk');
        await mount('youtube');

        expect(label()).toBe('Highlight on theguardian.com');
        expect(root().querySelector('.highlight .host')!.textContent).toBe('theguardian.com');
    });

    test('keeps the host in its own element, so a long one can be cut with an ellipsis', async () => {
        const long = 'a-very-long-subdomain-name.another-long-label.example-organisation.co.uk';
        onTab(`https://${long}/`);
        await mount('youtube');

        const host = root().querySelector('.highlight .host') as HTMLElement;
        expect(host.textContent).toBe(long);
        expect(host.title).toBe(long);
        expect(site()).not.toBeNull();
        expect(host.parentElement!.className).toBe('l site');
    });

    test('is on for a site that was never switched off, writes nothing by itself, and has no sub-line', async () => {
        await mount('youtube');

        expect(site().checked).toBe(true);
        expect(site().disabled).toBe(false);
        expect(sub()).toBeNull();
        expect(root().textContent).not.toContain('Manage sites');
        expect(prefsStore[PREFS_KEY]).toBeUndefined();
    });

    test('is off for a listed host, whichever way the tab spells it', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['theguardian.com'] };
        onTab('https://www.theguardian.com/uk');
        await mount('youtube');

        expect(site().checked).toBe(false);
    });

    test('off: a sub-line "Off on this site." with the "Manage sites" link, indented under the label', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['en.wikipedia.org'] };
        await mount('youtube');

        expect(sub()!.textContent).toBe('Off on this site. Manage sites');
        expect(sub()!.querySelector('button.lnk')!.textContent).toBe('Manage sites');
        expect(sub()!.previousElementSibling).toBe(root().querySelector('.highlight .mi'));
        expect(visibleRows().slice(-4)).toEqual(['Highlight on en.wikipedia.org', 'Off on this site. Manage sites', '---', 'Settings']);
    });

    test('the sub-line follows the switch: it appears when turned off and goes when turned on', async () => {
        await mount('youtube');
        expect(sub()).toBeNull();

        await flip();
        expect(sub()!.textContent).toBe('Off on this site. Manage sites');

        await flip();
        expect(sub()).toBeNull();
    });

    test('"Manage sites" opens the extension\'s settings page at #highlight and closes the popup', async () => {
        prefsStore[PREFS_KEY] = { highlightOffHosts: ['en.wikipedia.org'] };
        await mount('youtube');

        await click(root().querySelector('.highlight .lnk') as HTMLElement);

        expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/settings.html#highlight' }]]);
        expect(openOptionsPageMock).not.toHaveBeenCalled();
        expect(window.close).toHaveBeenCalledTimes(1);
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

        expect((root().querySelector('.highlight') as HTMLElement).hidden).toBe(true);
        expect(root().querySelector('.highlight input')).toBeNull();
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

            expect(root().querySelector('.highlight input')).toBeNull();
            expect(root().querySelector('.highlight .mi')).toBeNull();
            expect((root().querySelector('.highlight') as HTMLElement).hidden).toBe(true);
            expect(root().textContent).not.toContain('Highlight on');
            expect(root().textContent).not.toContain('Manage sites');
            expect(root().textContent).not.toContain('Highlighting is off');
        });
    });

    test('with no tab URL (not exposed to the popup) there is no row', async () => {
        tabsQueryMock.mockResolvedValue([{ id: 4 }]);
        await mount('youtube');

        expect(root().querySelector('.highlight input')).toBeNull();
        expect(root().textContent).not.toContain('Highlight on');
    });

    test('with no tab at all, or a failing query, there is no row', async () => {
        tabsQueryMock.mockResolvedValue([]);
        await mount('youtube');
        expect(root().querySelector('.highlight input')).toBeNull();

        document.body.innerHTML = POPUP_HTML;
        jest.resetModules();
        tabsQueryMock.mockRejectedValue(new Error('no'));
        await mount('youtube');
        expect(root().querySelector('.highlight input')).toBeNull();
    });

    describe('with highlighting off on all websites', () => {
        beforeEach(() => {
            prefsStore[PREFS_KEY] = { pageHighlight: false, highlightOffHosts: [] };
        });

        test('the row reads that, has no switch, and the sub-line is just "Manage sites"', async () => {
            await mount('youtube');

            expect(visibleRows().slice(-4)).toEqual(['Highlighting is off on all websites', 'Manage sites', '---', 'Settings']);
            expect(root().querySelector('.highlight input')).toBeNull();
            expect(root().querySelector('.highlight .sw')).toBeNull();
            expect(root().textContent).not.toContain('Off on this site.');
            expect(root().textContent).not.toContain('Highlight on');
        });

        test('"Manage sites" opens settings.html#highlight and closes the popup', async () => {
            await mount('youtube');

            await click(root().querySelector('.highlight .lnk') as HTMLElement);

            expect(tabsCreateMock.mock.calls).toEqual([[{ url: 'chrome-extension://test-extension-id/settings.html#highlight' }]]);
            expect(window.close).toHaveBeenCalledTimes(1);
        });

        test('on a tab with no such row it is not shown either', async () => {
            onTab('chrome://newtab/');
            await mount('youtube');

            expect(root().textContent).not.toContain('Highlighting is off');
            expect(root().textContent).not.toContain('Manage sites');
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

    test('sits last, under the one separator, with the sliders icon', async () => {
        withStatus({ signedIn: false, inboxCount: 0 });
        await mount('youtube');

        const kids = [...root().children];
        expect(kids[kids.length - 1].textContent).toBe('Settings');
        expect(kids[kids.length - 1].tagName).toBe('BUTTON');
        expect(kids[kids.length - 2].className).toBe('msep');
        expect(root().querySelectorAll('.msep')).toHaveLength(1);
        expect(kids[kids.length - 1].querySelectorAll('svg circle')).toHaveLength(2);
    });
});
