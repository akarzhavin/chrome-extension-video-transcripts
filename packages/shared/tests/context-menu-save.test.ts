/**
 * "Save to Lingogram" in the right-click menu.
 *
 * What the learner relies on: pressing the item saves exactly what they
 * selected, signed-out presses lead to the sign-in popup instead of a silent
 * nothing, and a page the extension may not read (chrome://, the Web Store)
 * still saves the word, just without a paragraph around it.
 */

const handleAuthMessage = jest.fn(async (_req: Record<string, unknown>) => ({ ok: true }));
const getAuthState = jest.fn(async () => ({ uid: 'u' }) as unknown);
const setMirrorEntry = jest.fn(async (_term: string, _state: string) => {});
const track = jest.fn(async () => {});

jest.mock('../src/auth/background', () => ({
    handleAuthMessage: (req: Record<string, unknown>) => handleAuthMessage(req),
}));
jest.mock('../src/auth/storage', () => ({ getAuthState: () => getAuthState() }));
jest.mock('../src/word-mirror', () => ({
    setMirrorEntry: (t: string, s: string) => setMirrorEntry(t, s),
}));
jest.mock('../src/analytics-bg', () => ({ track: (...a: unknown[]) => (track as any)(...a) }));

const listeners: {
    installed?: () => void;
    startup?: () => void;
    clicked?: (i: any, t: any) => void;
    external?: (m: any, sender: any, respond: (r: unknown) => void) => boolean;
} = {};
// The menu as Chrome holds it: removeAll empties it, create adds one item.
const live: any[] = [];
const removeAll = jest.fn((cb?: () => void) => {
    live.length = 0;
    cb?.();
});
const create = jest.fn((o: any) => live.push(o));
const executeScript = jest.fn(async (_opts: any): Promise<any[]> => [{ result: 'the paragraph around it' }]);
const openPopup = jest.fn(async (_opts?: any) => {});
const sendMessage = jest.fn(async (_id: string, _msg: unknown): Promise<unknown> => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
});

const DEV_ID = 'abcdefghijklmnopabcdefghijklmnop';
(global as any).chrome = {
    runtime: {
        id: DEV_ID,
        sendMessage,
        onInstalled: { addListener: (f: () => void) => (listeners.installed = f) },
        onStartup: { addListener: (f: () => void) => (listeners.startup = f) },
        onMessageExternal: { addListener: (f: any) => (listeners.external = f) },
    },
    contextMenus: {
        removeAll,
        create,
        onClicked: { addListener: (f: any) => (listeners.clicked = f) },
    },
    scripting: { executeScript },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), openPopup },
    i18n: { getMessage: jest.fn(() => '') }, // English fallbacks
};

import { MAX_TERM_LEN, installContextMenuSave } from '../src/context-menu-save';
import { EDITION_IDS } from '../src/sibling';

const TAB = { id: 7, windowId: 3, url: 'https://example.com/a', title: 'A page' };
const click = (selectionText: string, menuItemId = 'lingogram-add-to-inbox') =>
    (listeners.clicked as any)({ menuItemId, selectionText, pageUrl: 'https://example.com/a' }, TAB);
const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
    jest.clearAllMocks();
    live.length = 0;
    delete listeners.external;
    (global as any).chrome.runtime.id = DEV_ID;
    sendMessage.mockImplementation(async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    getAuthState.mockImplementation(async () => ({ uid: 'u' }));
    executeScript.mockImplementation(async () => [{ result: 'the paragraph around it' }]);
    installContextMenuSave();
});

describe('menu', () => {
    it('holds exactly one item for selections, however many times it is synced', async () => {
        await flush(); // the sync every worker start runs
        listeners.installed!();
        listeners.startup!();
        await flush();
        expect(live).toHaveLength(1);
        expect(live[0]).toEqual({ id: 'lingogram-add-to-inbox', contexts: ['selection'], title: 'Save to Lingogram' });
    });

    it('ignores a click on someone else’s item', async () => {
        await click('word', 'some-other-item');
        await flush();
        expect(handleAuthMessage).not.toHaveBeenCalled();
    });
});

describe('saving', () => {
    it('sends the selection exactly as selected, with context, as a silent web save', async () => {
        await click('  Run Away ');
        await flush();
        expect(handleAuthMessage).toHaveBeenCalledTimes(1);
        const req = handleAuthMessage.mock.calls[0][0];
        // Not lowercased here: the store keys the word itself.
        expect(req).toMatchObject({
            action: 'ADD_WORD',
            term: 'Run Away',
            context: 'the paragraph around it',
            site: 'web',
            silent: true,
        });
        // The page's address and title are never sent.
        expect(req).not.toHaveProperty('sourceUrl');
        expect(req).not.toHaveProperty('title');
        expect(setMirrorEntry).toHaveBeenCalledWith('Run Away', 'active');
    });

    it('still saves, with an empty context, when the page cannot be read', async () => {
        executeScript.mockImplementationOnce(async () => {
            throw new Error('Cannot access a chrome:// URL');
        });
        await click('word');
        await flush();
        expect(handleAuthMessage.mock.calls[0][0]).toMatchObject({ term: 'word', context: '' });
    });

    it.each([['', 'empty'], ['   ', 'blank'], ['x'.repeat(MAX_TERM_LEN + 1), 'too long']])(
        'does nothing for a %# selection (%s)',
        async (sel) => {
            await click(sel);
            await flush();
            expect(handleAuthMessage).not.toHaveBeenCalled();
            expect(getAuthState).not.toHaveBeenCalled();
        },
    );

    it('accepts a selection exactly at the length limit', async () => {
        await click('x'.repeat(MAX_TERM_LEN));
        await flush();
        expect(handleAuthMessage).toHaveBeenCalledTimes(1);
    });
});

describe('signed out', () => {
    it('opens the sign-in popup in the clicked window and saves nothing', async () => {
        getAuthState.mockImplementation(async () => null);
        await click('word');
        await flush();
        expect(openPopup).toHaveBeenCalledWith({ windowId: 3 });
        expect(handleAuthMessage).not.toHaveBeenCalled();
        expect(setMirrorEntry).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledWith('signin_started', { from: 'context_menu' });
    });

    it('falls back to a toast when the popup cannot open', async () => {
        getAuthState.mockImplementation(async () => null);
        openPopup.mockImplementationOnce(async () => {
            throw new Error('no focused window');
        });
        await click('word');
        await flush();
        const toastCall = executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 3);
        expect(toastCall?.[0].args[0]).toBe('Sign in to save words');
    });
});

describe('failures', () => {
    it('sends a revoked session to the sign-in popup, not to an error toast', async () => {
        handleAuthMessage.mockImplementationOnce(async () => {
            throw new Error('INVALID_REFRESH_TOKEN');
        });
        await click('word');
        await flush();
        expect(openPopup).toHaveBeenCalled();
        expect(setMirrorEntry).not.toHaveBeenCalled();
    });

    it('reports any other failure in a toast and leaves the mirror alone', async () => {
        handleAuthMessage.mockImplementationOnce(async () => {
            throw new Error('network down');
        });
        await click('word');
        await flush();
        expect(setMirrorEntry).not.toHaveBeenCalled();
        const toastCall = executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 3);
        expect(toastCall?.[0].args).toEqual(["Couldn't save: network down", false, 2500]);
    });
});

describe('two editions installed side by side', () => {
    const asEdition = async (id: string) => {
        (global as any).chrome.runtime.id = id;
        live.length = 0;
        installContextMenuSave();
        await flush();
    };
    const youtubeAnswers = (reply: unknown) =>
        sendMessage.mockImplementation(async (id: string) => {
            if (id === EDITION_IDS.youtube) return reply;
            throw new Error('Receiving end does not exist.');
        });

    it('the HDrezka edition hides its item while the YouTube edition answers', async () => {
        youtubeAnswers({ ok: true });
        await asEdition(EDITION_IDS.rezka);
        expect(sendMessage).toHaveBeenCalledWith(EDITION_IDS.youtube, { type: 'lingogram-sibling', op: 'ping' });
        expect(live).toHaveLength(0);
    });

    it('the HDrezka edition keeps its item when the YouTube edition is absent', async () => {
        await asEdition(EDITION_IDS.rezka);
        expect(live).toHaveLength(1);
    });

    it('a refusal is not an answer: an old YouTube edition still leaves the item in place', async () => {
        // What the sign-in listener of a version without the handshake replies.
        youtubeAnswers({ ok: false, error: 'unauthorized origin' });
        await asEdition(EDITION_IDS.rezka);
        expect(live).toHaveLength(1);
    });

    it('the YouTube edition never asks and always keeps its item', async () => {
        youtubeAnswers({ ok: true });
        await asEdition(EDITION_IDS.youtube);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(live).toHaveLength(1);
    });

    it('the YouTube edition, once installed, tells HDrezka to look again', async () => {
        await asEdition(EDITION_IDS.youtube);
        sendMessage.mockImplementation(async () => ({ ok: true }));
        listeners.installed!();
        await flush();
        expect(sendMessage).toHaveBeenCalledWith(EDITION_IDS.rezka, { type: 'lingogram-sibling', op: 'sync' });
    });

    it('HDrezka drops its item when told to look again', async () => {
        await asEdition(EDITION_IDS.rezka);
        expect(live).toHaveLength(1);
        youtubeAnswers({ ok: true });
        const respond = jest.fn();
        listeners.external!({ type: 'lingogram-sibling', op: 'sync' }, { id: EDITION_IDS.youtube }, respond);
        await flush();
        expect(live).toHaveLength(0);
        expect(respond).toHaveBeenCalledWith({ ok: true });
    });

    it('answers the ping from its sibling only', async () => {
        await asEdition(EDITION_IDS.youtube);
        const fromSibling = jest.fn();
        listeners.external!({ type: 'lingogram-sibling', op: 'ping' }, { id: EDITION_IDS.rezka }, fromSibling);
        expect(fromSibling).toHaveBeenCalledWith({ ok: true });
        const fromStranger = jest.fn();
        listeners.external!({ type: 'lingogram-sibling', op: 'ping' }, { id: DEV_ID }, fromStranger);
        expect(fromStranger).not.toHaveBeenCalled();
    });

    it('a dev build has no sibling and listens for none', async () => {
        await asEdition(DEV_ID);
        expect(listeners.external).toBeUndefined();
        expect(live).toHaveLength(1);
    });
});
