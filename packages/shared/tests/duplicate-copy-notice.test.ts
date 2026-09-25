// The "Lingogram is running twice" notice.
//
// Two enabled copies of one edition both act on the page: one press of the
// word card's Save sent two saves, one per copy (measured live 2026-09-25), and
// the learner saw either a sign-in request while signed in or a raw
// `Firestore rules 403`. Neither symptom names the cause, so what these checks
// hold is that the copy which yields the panel SAYS so, and that the way out it
// offers reaches the other copy's switch.

function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn(async () => ({})),
        set: jest.fn(async (obj: Record<string, unknown>) => Object.assign(store, obj)),
        remove: jest.fn(async () => {}),
    };
}

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_ID = 'pkoibjilnaeadmcnmfkgcjhalljbmfan';

const sendMessage = jest.fn((_msg: unknown, cb?: (res: unknown) => void) => cb?.({ ok: true }));
const tabsCreate = jest.fn(async () => ({}));
(global as any).chrome = {
    runtime: {
        id: OWN_ID,
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage,
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        lastError: undefined,
    },
    storage: { local: makeStorageArea(), session: makeStorageArea() },
    i18n: { getMessage: () => '' },
    tabs: { create: tabsCreate },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
};

jest.mock('../src/analytics-bg', () => ({
    track: jest.fn(async () => {}),
    handleTrackMessage: jest.fn(async () => ({ ok: true })),
}));

import { showDuplicateCopyNotice, watchForDuplicateCopy } from '../src/content/duplicate-copy-notice';
import { handleAuthMessage, isAuthAction } from '../src/auth/background';

/** The other copy's panel, down to the banner slot the notice mounts under. */
function foreignPanel(owner = OTHER_ID, withSubheader = true): HTMLElement {
    const el = document.createElement('div');
    el.id = 'vtt-sidebar';
    el.dataset.vttOwner = owner;
    el.innerHTML =
        '<div id="vtt-header"></div>' +
        (withSubheader ? '<div id="vtt-subheader"></div>' : '') +
        '<div id="vtt-list"></div>';
    document.body.appendChild(el);
    return el;
}

const notice = (): HTMLElement | null => document.getElementById('vtt-duplicate-notice');

beforeEach(() => {
    document.body.innerHTML = '';
    sendMessage.mockClear();
    tabsCreate.mockClear();
    jest.useFakeTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('watchForDuplicateCopy', () => {
    it('shows the notice in the banner slot of a panel another copy owns', () => {
        foreignPanel();
        watchForDuplicateCopy(OWN_ID);
        const el = notice();
        expect(el).not.toBeNull();
        // The slot: right after #vtt-subheader, where the other announcements go.
        expect(document.getElementById('vtt-subheader')!.nextElementSibling).toBe(el);
        expect(el!.textContent).toContain('Lingogram is running twice');
    });

    it('stays silent when the panel is this copy\'s own', () => {
        foreignPanel(OWN_ID);
        watchForDuplicateCopy(OWN_ID);
        jest.advanceTimersByTime(10_000);
        expect(notice()).toBeNull();
    });

    // The owner may still be building its panel at the moment this copy yields.
    it('shows the notice once the other panel\'s banner slot exists', () => {
        const panel = foreignPanel(OTHER_ID, false);
        watchForDuplicateCopy(OWN_ID);
        expect(notice()).toBeNull();

        const sub = document.createElement('div');
        sub.id = 'vtt-subheader';
        panel.prepend(sub);
        jest.advanceTimersByTime(2_000);
        expect(notice()).not.toBeNull();
    });

    // The owner can rebuild its panel and drop the banner with it.
    it('puts the notice back after the panel is rebuilt', () => {
        foreignPanel();
        watchForDuplicateCopy(OWN_ID);
        notice()!.remove();
        jest.advanceTimersByTime(2_000);
        expect(notice()).not.toBeNull();
        expect(document.querySelectorAll('#vtt-duplicate-notice')).toHaveLength(1);
    });

    it('takes the notice down when the other panel is gone', () => {
        const panel = foreignPanel();
        watchForDuplicateCopy(OWN_ID);
        expect(notice()).not.toBeNull();
        panel.remove();
        // The notice lived inside that panel; a fresh slot must not grow one.
        document.body.innerHTML = '<div id="vtt-subheader"></div>';
        jest.advanceTimersByTime(2_000);
        expect(notice()).toBeNull();
    });
});

describe('the way out', () => {
    it('asks the worker to open the OTHER copy\'s extension page', () => {
        foreignPanel();
        showDuplicateCopyNotice(OTHER_ID);
        notice()!.querySelector<HTMLButtonElement>('button')!.click();
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0]).toEqual({ action: 'OPEN_EXTENSION_PAGE', id: OTHER_ID });
    });

    // The id is read from the page's DOM, which any script on the page can write.
    it('offers no button for an owner stamp that is not an extension id', () => {
        foreignPanel('javascript:alert(1)');
        showDuplicateCopyNotice('javascript:alert(1)');
        expect(notice()).not.toBeNull();
        expect(notice()!.querySelector('button')).toBeNull();
    });

    it('is a message the worker accepts', () => {
        expect(isAuthAction('OPEN_EXTENSION_PAGE')).toBe(true);
    });

    it('opens chrome://extensions on the other copy\'s details', async () => {
        await expect(handleAuthMessage({ action: 'OPEN_EXTENSION_PAGE', id: OTHER_ID })).resolves.toEqual({ ok: true });
        expect(tabsCreate).toHaveBeenCalledWith({ url: `chrome://extensions/?id=${OTHER_ID}` });
    });

    it('refuses anything but an extension id', async () => {
        await expect(
            handleAuthMessage({ action: 'OPEN_EXTENSION_PAGE', id: 'x&foo=https://evil.test' }),
        ).rejects.toThrow('bad extension id');
        expect(tabsCreate).not.toHaveBeenCalled();
    });
});
