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
jest.mock('../src/auth/storage', () => ({
    AUTH_UID_KEY: 'auth.uid',
    SIBLING_KEYS: { otherOwns: 'sibling.otherOwns', owner: 'sibling.owner' },
    getAuthState: () => getAuthState(),
}));
jest.mock('../src/word-mirror', () => ({
    setMirrorEntry: (t: string, s: string) => setMirrorEntry(t, s),
}));
jest.mock('../src/analytics-bg', () => ({ track: (...a: unknown[]) => (track as any)(...a) }));

const listeners: {
    installed?: () => void;
    startup?: () => void;
    clicked?: (i: any, t: any) => void;
    external?: (m: any, sender: any, respond: (r: unknown) => void) => boolean;
    storage?: (changes: Record<string, unknown>, area: string) => void;
} = {};
// The menu as Chrome holds it. Calls are queued and answered later, in order,
// as Chrome does; a create with an id already present fails with lastError.
const live: any[] = [];
const duplicateErrors: string[] = [];
const later = (f: () => void) => setTimeout(f, 0);
const removeAll = jest.fn((cb?: () => void) => {
    later(() => {
        live.length = 0;
        cb?.();
    });
});
const create = jest.fn((o: any, cb?: () => void) => {
    later(() => {
        const runtime = (global as any).chrome.runtime;
        if (live.some((i) => i.id === o.id)) {
            runtime.lastError = { message: `Cannot create item with duplicate id ${o.id}` };
            duplicateErrors.push(o.id); // a create that lost a race, checked or not
            cb?.();
            runtime.lastError = undefined;
            return;
        }
        live.push(o);
        cb?.();
    });
});
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
        onInstalled: { addListener: (f: (d?: unknown) => void) => (listeners.installed = f) },
        onStartup: { addListener: (f: () => void) => (listeners.startup = f) },
        onMessageExternal: { addListener: (f: any) => (listeners.external = f) },
        lastError: undefined as unknown,
    },
    storage: {
        local: {
            set: jest.fn(async (_o: Record<string, unknown>) => {}),
            get: jest.fn(async (_k: unknown): Promise<Record<string, unknown>> => ({})),
        },
        onChanged: { addListener: (f: any) => (listeners.storage = f) },
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
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(async () => {
    jest.clearAllMocks();
    live.length = 0;
    duplicateErrors.length = 0;
    delete listeners.external;
    (global as any).chrome.runtime.id = DEV_ID;
    sendMessage.mockImplementation(async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    getAuthState.mockImplementation(async () => ({ uid: 'u' }));
    executeScript.mockImplementation(async () => [{ result: 'the paragraph around it' }]);
    installContextMenuSave();
    // Let the wake sync settle, so a test sees only what its own action does.
    await flush();
    getAuthState.mockClear();
    sendMessage.mockClear();
});

describe('menu', () => {
    it('holds exactly one item, with no duplicate-id error, when install and startup race the wake sync', async () => {
        listeners.installed!();
        listeners.startup!();
        await flush();
        expect(live).toHaveLength(1);
        expect(live[0]).toEqual({ id: 'lingogram-add-to-inbox', contexts: ['selection'], title: 'Save to Lingogram' });
        expect(duplicateErrors).toEqual([]);
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
    // The learner has no account: the worker keeps the word in the browser, so
    // the menu saves like any other time and shows the normal toast. No sign-in
    // popup, no "!" on the toolbar.
    const toastText = () =>
        executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 3)?.[0].args[0];

    it('saves through the worker and shows the saved toast', async () => {
        getAuthState.mockImplementation(async () => null);
        handleAuthMessage.mockImplementationOnce(async () => ({ ok: true, local: true }));
        await click('word');
        await flush();
        expect(handleAuthMessage).toHaveBeenCalledTimes(1);
        expect(handleAuthMessage.mock.calls[0][0]).toMatchObject({ action: 'ADD_WORD', term: 'word', site: 'web' });
        expect(setMirrorEntry).toHaveBeenCalledWith('word', 'active');
        expect(toastText()).toBe('Saved: word');
    });

    it('does not open the sign-in popup or touch the badge', async () => {
        getAuthState.mockImplementation(async () => null);
        handleAuthMessage.mockImplementationOnce(async () => ({ ok: true, local: true }));
        await click('word');
        await flush();
        expect(openPopup).not.toHaveBeenCalled();
        expect((global as any).chrome.action.setBadgeText).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalledWith('signin_started', expect.anything());
    });
});

describe('failures', () => {
    it('a dead session still ends in a saved toast: the worker keeps the word locally', async () => {
        // What handleAuthMessage does on a dead session: clears it, stores the
        // word in the browser and answers ok.
        handleAuthMessage.mockImplementationOnce(async () => {
            getAuthState.mockImplementation(async () => null);
            return { ok: true, local: true };
        });
        await click('word');
        await flush();
        expect(openPopup).not.toHaveBeenCalled();
        expect(setMirrorEntry).toHaveBeenCalledWith('word', 'active');
        const toastCall = executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 3);
        expect(toastCall?.[0].args[0]).toBe('Saved: word');
    });

    it('a refusal by the rules keeps a signed-in learner where they are', async () => {
        // A save within a second of another one: the session is fine, so
        // handleAuthMessage leaves it in place, but the message says 403.
        handleAuthMessage.mockImplementationOnce(async () => {
            throw new Error('Firestore rules 403: PERMISSION_DENIED');
        });
        await click('word');
        await flush();
        expect(openPopup).not.toHaveBeenCalled();
        expect((global as any).chrome.action.setBadgeText).not.toHaveBeenCalled();
        const toastCall = executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 3);
        expect(toastCall?.[0].args[0]).toBe("Couldn't save: Firestore rules 403: PERMISSION_DENIED");
    });

    it('reads the context from the frame the selection is in', async () => {
        (listeners.clicked as any)({ menuItemId: 'lingogram-add-to-inbox', selectionText: 'word', frameId: 4 }, TAB);
        await flush();
        const grab = executeScript.mock.calls.find((c) => Array.isArray(c[0].args) && c[0].args.length === 1);
        expect(grab?.[0].target).toEqual({ tabId: 7, frameIds: [4] });
        expect(grab?.[0].args).toEqual([1000]);
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
    const asEdition = async (id: string, signedIn: boolean) => {
        (global as any).chrome.runtime.id = id;
        getAuthState.mockImplementation(async () => (signedIn ? { uid: 'u' } : null));
        live.length = 0;
        installContextMenuSave();
        await flush();
    };
    /** The other edition answers `status` with this sign-in state. */
    const siblingAnswers = (otherId: string, reply: unknown) =>
        sendMessage.mockImplementation(async (id: string) => {
            if (id === otherId) return reply;
            throw new Error('Receiving end does not exist.');
        });

    // Who keeps the item, by who is signed in. Both editions evaluate the same
    // rule, so each row is checked from both sides: exactly one item overall.
    const matrix: Array<[boolean, boolean, 'youtube' | 'rezka']> = [
        [true, false, 'youtube'],
        [false, true, 'rezka'],
        [true, true, 'youtube'],
        [false, false, 'youtube'],
    ];
    it.each(matrix)('YouTube signed in %s, HDrezka signed in %s: the %s edition keeps the item', async (yt, rz, owner) => {
        siblingAnswers(EDITION_IDS.rezka, { ok: true, signedIn: rz });
        await asEdition(EDITION_IDS.youtube, yt);
        const youtubeShows = live.length === 1;
        siblingAnswers(EDITION_IDS.youtube, { ok: true, signedIn: yt });
        await asEdition(EDITION_IDS.rezka, rz);
        const rezkaShows = live.length === 1;
        // The page highlighter of this edition reads the same answer.
        const rezkaYields = (global as any).chrome.storage.local.set.mock.calls.at(-1)[0]['sibling.otherOwns'];
        expect({ youtubeShows, rezkaShows, rezkaYields }).toEqual({
            youtubeShows: owner === 'youtube',
            rezkaShows: owner === 'rezka',
            rezkaYields: owner === 'youtube',
        });
    });

    // The popup and the settings page read WHO paints, to point there instead
    // of offering highlight settings this edition's painter never reads.
    it.each(matrix)('YouTube signed in %s, HDrezka signed in %s: the yielding edition records the %s edition as owner', async (yt, rz, owner) => {
        const lastSet = () => (global as any).chrome.storage.local.set.mock.calls.at(-1)[0]['sibling.owner'];
        siblingAnswers(EDITION_IDS.rezka, { ok: true, signedIn: rz });
        await asEdition(EDITION_IDS.youtube, yt);
        const fromYoutube = lastSet();
        siblingAnswers(EDITION_IDS.youtube, { ok: true, signedIn: yt });
        await asEdition(EDITION_IDS.rezka, rz);
        const fromRezka = lastSet();
        expect({ fromYoutube, fromRezka }).toEqual(
            owner === 'youtube'
                ? { fromYoutube: null, fromRezka: { edition: 'youtube', id: EDITION_IDS.youtube } }
                : { fromYoutube: { edition: 'rezka', id: EDITION_IDS.rezka }, fromRezka: null },
        );
    });

    // Ownership moves here (HDrezka signs in, YouTube is signed out) while the
    // previous owner still answers: its highlight settings come along.
    it('taking ownership over, asks the previous owner for its highlight settings', async () => {
        const get = (global as any).chrome.storage.local.get as jest.Mock;
        get.mockImplementation(async () => ({ 'sibling.otherOwns': true }));
        const asked: unknown[] = [];
        sendMessage.mockImplementation(async (id: string, m: any) => {
            if (id !== EDITION_IDS.youtube) throw new Error('Receiving end does not exist.');
            asked.push(m.op);
            return m.op === 'status' ? { ok: true, signedIn: false } : { ok: true, prefs: { pageHighlight: true, highlightOffHosts: [] } };
        });
        try {
            await asEdition(EDITION_IDS.rezka, true);
            expect(asked).toContain('highlightGet');
        } finally {
            get.mockImplementation(async () => ({}));
        }
    });

    it('keeping ownership, asks for nothing', async () => {
        const asked: unknown[] = [];
        sendMessage.mockImplementation(async (id: string, m: any) => {
            if (id !== EDITION_IDS.rezka) throw new Error('Receiving end does not exist.');
            asked.push(m.op);
            return { ok: true, signedIn: false };
        });
        await asEdition(EDITION_IDS.youtube, true);
        expect(asked).not.toContain('highlightGet');
    });

    it('keeps the item when the other edition is absent', async () => {
        await asEdition(EDITION_IDS.rezka, false);
        expect(live).toHaveLength(1);
    });

    it('a refusal is not an answer: an older other edition leaves the item in place', async () => {
        // What the sign-in listener of a version without this message replies.
        siblingAnswers(EDITION_IDS.youtube, { ok: false, error: 'unauthorized origin' });
        await asEdition(EDITION_IDS.rezka, false);
        expect(live).toHaveLength(1);
    });

    it('answers `status` with its own sign-in state, to its sibling only', async () => {
        await asEdition(EDITION_IDS.youtube, true);
        const fromSibling = await new Promise((resolve) => {
            const async = listeners.external!({ type: 'lingogram-sibling', op: 'status' }, { id: EDITION_IDS.rezka }, resolve);
            expect(async).toBe(true);
        });
        expect(fromSibling).toEqual({ ok: true, signedIn: true });
        const fromStranger = jest.fn();
        expect(listeners.external!({ type: 'lingogram-sibling', op: 'status' }, { id: DEV_ID }, fromStranger)).toBe(false);
        expect(fromStranger).not.toHaveBeenCalled();
    });

    it('answers the stats choice to its sibling only', async () => {
        await asEdition(EDITION_IDS.youtube, true);
        const get = (global as any).chrome.storage.local.get as jest.Mock;
        get.mockImplementation(async () => ({ 'prefs.v1': { analyticsEnabled: false } }));
        try {
            const reply = await new Promise((resolve) => {
                expect(listeners.external!({ type: 'lingogram-sibling', op: 'analyticsGet' }, { id: EDITION_IDS.rezka }, resolve)).toBe(true);
            });
            expect(reply).toEqual({ ok: true, on: false });
        } finally {
            get.mockImplementation(async () => ({}));
        }
        const fromStranger = jest.fn();
        expect(listeners.external!({ type: 'lingogram-sibling', op: 'analyticsSet', on: false }, { id: DEV_ID }, fromStranger)).toBe(false);
        expect(fromStranger).not.toHaveBeenCalled();
    });

    it('stores the stats choice the sibling sends', async () => {
        await asEdition(EDITION_IDS.youtube, true);
        const set = (global as any).chrome.storage.local.set as jest.Mock;
        set.mockClear();
        const reply = await new Promise((resolve) => {
            listeners.external!({ type: 'lingogram-sibling', op: 'analyticsSet', on: false }, { id: EDITION_IDS.rezka }, resolve);
        });
        expect(reply).toEqual({ ok: true });
        expect(set.mock.calls.map(([o]) => o['prefs.v1']?.analyticsEnabled)).toContain(false);
    });

    it.each([
        ['install', true],
        ['update', false],
    ])('on %s, asks the other edition whether stats are off: %s', async (reason, asks) => {
        await asEdition(EDITION_IDS.rezka, false);
        sendMessage.mockClear();
        listeners.installed!({ reason } as any);
        await flush();
        const ops = sendMessage.mock.calls.map(([, m]) => (m as any).op);
        expect(ops.includes('analyticsGet')).toBe(asks);
    });

    it('signing in moves the item here, and tells the other edition', async () => {
        siblingAnswers(EDITION_IDS.youtube, { ok: true, signedIn: true });
        await asEdition(EDITION_IDS.rezka, false);
        expect(live).toHaveLength(0);
        // Signed in here; signed out there.
        getAuthState.mockImplementation(async () => ({ uid: 'u' }));
        siblingAnswers(EDITION_IDS.youtube, { ok: true, signedIn: false });
        listeners.storage!({ 'auth.uid': { newValue: 'u' } }, 'local');
        await flush();
        expect(live).toHaveLength(1);
        expect(sendMessage).toHaveBeenCalledWith(EDITION_IDS.youtube, { type: 'lingogram-sibling', op: 'sync' });
    });

    it('decides again when the other edition says its sign-in changed', async () => {
        siblingAnswers(EDITION_IDS.rezka, { ok: true, signedIn: false });
        await asEdition(EDITION_IDS.youtube, false);
        expect(live).toHaveLength(1);
        siblingAnswers(EDITION_IDS.rezka, { ok: true, signedIn: true });
        listeners.external!({ type: 'lingogram-sibling', op: 'sync' }, { id: EDITION_IDS.rezka }, jest.fn());
        await flush();
        expect(live).toHaveLength(0);
    });

    it('a build that is neither edition has no sibling and listens for none', async () => {
        await asEdition(DEV_ID, false);
        expect(listeners.external).toBeUndefined();
        expect(live).toHaveLength(1);
    });
});
