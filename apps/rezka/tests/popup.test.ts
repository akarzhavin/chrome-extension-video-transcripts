/**
 * @jest-environment jsdom
 */

const sendMessageMock = jest.fn();

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
    storage: { local: storageLocal, onChanged: { addListener: jest.fn() } },
};

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessageMock.mockReset();
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

    test('has the HDrezka switch and the highlight, and no YouTube or Netflix switch', async () => {
        sendMessageMock.mockImplementation((_msg, cb) => cb({ signedIn: false, inboxCount: 0 }));
        await import('../src/popup/popup');
        await nextTick();

        const prefs = Array.from(document.querySelectorAll<HTMLInputElement>('.switches input')).map((i) => i.dataset.pref);
        expect(prefs).toEqual(['siteRezka', 'pageHighlight']);
        expect(document.querySelector('.switches .row-label')?.textContent).toBe('Subtitles on HDrezka');
    });

    test('has no language pickers and no privacy switch: both are on the settings page', async () => {
        sendMessageMock.mockImplementation((_msg, cb) => cb({ signedIn: false, inboxCount: 0 }));
        await import('../src/popup/popup');
        await nextTick();

        expect(document.querySelector('select')).toBeNull();
        expect(document.querySelector('input[data-pref="analyticsEnabled"]')).toBeNull();
    });
});
