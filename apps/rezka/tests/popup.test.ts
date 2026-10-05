/**
 * @jest-environment jsdom
 */

const sendMessageMock = jest.fn();
const tabsQuery = jest.fn().mockResolvedValue([]);

// The switches read and write prefs, so this suite needs a storage stub too:
// without one loadPrefs() bails to defaults and a switch's stored state could
// never be observed.
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
        lastError: undefined,
    },
    tabs: { create: jest.fn(), query: tabsQuery },
    storage: { local: storageLocal, onChanged: { addListener: jest.fn() } },
};

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessageMock.mockReset();
    tabsQuery.mockReset().mockResolvedValue([]);
    Object.keys(prefsStore).forEach((k) => delete prefsStore[k]);
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
    jest.resetModules();
});

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the HDrezka popup', () => {
    test('a signed-out learner with no words gets the card and the quiet sign-in link', async () => {
        sendMessageMock.mockImplementationOnce((_msg, cb) => {
            cb({ signedIn: false, inboxCount: 0 });
        });

        await import('../src/popup/popup');
        await nextTick();

        const root = document.getElementById('root')!;
        expect(root.querySelector('h1')?.textContent).toBe('Lingogram');
        expect(root.querySelector('input[type="email"]')).toBeNull();
        expect(root.querySelector('.hero-title')?.textContent).toBe('Save words as you watch');
        expect(root.querySelector('button.primary')).toBeNull();
        expect(Array.from(root.querySelectorAll('button')).map((b) => b.textContent)).toContain('Sign in on Lingogram');
    });

    test('a signed-in learner gets the account count and the vocabulary button', async () => {
        sendMessageMock.mockImplementationOnce((_msg, cb) => {
            cb({ signedIn: true, email: 'student@example.com', uid: 'u-1', inboxCount: 7 });
        });

        await import('../src/popup/popup');
        await nextTick();

        const root = document.getElementById('root')!;
        expect(root.querySelector('.big')?.textContent).toBe('7');
        expect(root.querySelector('button.primary')?.textContent).toBe('Open my vocabulary');
        expect(root.textContent).not.toContain('student@example.com');
    });

    test('has no video-site switch: the HDrezka one is on the settings page', async () => {
        sendMessageMock.mockImplementation((_msg, cb) => cb({ signedIn: false, inboxCount: 0 }));
        await import('../src/popup/popup');
        await nextTick();

        expect(document.querySelector('input[data-pref="siteRezka"]')).toBeNull();
        expect(document.querySelector('.switches input')).toBeNull();
        expect(document.body.textContent).not.toContain('Subtitles on HDrezka');
    });

    test('names the tab\'s site in the one switch it has', async () => {
        sendMessageMock.mockImplementation((_msg, cb) => cb({ signedIn: false, inboxCount: 0 }));
        tabsQuery.mockResolvedValue([{ url: 'https://www.example.org/a' }]);
        await import('../src/popup/popup');
        await nextTick();
        await nextTick();

        expect(document.querySelector('.switches .row-label')?.textContent).toBe('Highlight words on example.org');
    });

    test('has no language pickers and no privacy switch: both are on the settings page', async () => {
        sendMessageMock.mockImplementation((_msg, cb) => cb({ signedIn: false, inboxCount: 0 }));
        await import('../src/popup/popup');
        await nextTick();

        expect(document.querySelector('select')).toBeNull();
        expect(document.querySelector('input[data-pref="analyticsEnabled"]')).toBeNull();
    });
});
