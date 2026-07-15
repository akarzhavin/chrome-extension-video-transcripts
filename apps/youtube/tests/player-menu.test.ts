// Chrome stub must exist before the module graph is imported: player-menu.ts
// reads chrome.runtime.getURL at install time.
let lastMessage: any = null;
let messageReply: any = { signedIn: false };

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: jest.fn((msg: any, cb?: (res: any) => void) => {
            lastMessage = msg;
            cb?.(messageReply);
        }),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' }, // force the English fallbacks
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { installPlayerMenu } from '../src/content/player-menu';

interface FakeUi {
    toggleOverlay: jest.Mock;
    toggleDualMode: jest.Mock;
    toggleGuessMode: jest.Mock;
    toggleCollapsed: jest.Mock;
    openPanel: jest.Mock;
    openSettings: jest.Mock;
    isCollapsed: jest.Mock;
    registerExternalElement: jest.Mock;
    onRefresh: jest.Mock;
}

function makeApp(over: Partial<{
    displayMode: string;
    overlayEnabled: boolean;
    tracks: unknown[];
    langPrefs: unknown;
    multiple: boolean;
    collapsed: boolean;
    learningTrack: boolean;
    nativeTrack: boolean;
}> = {}) {
    const ui: FakeUi = {
        toggleOverlay: jest.fn(),
        toggleDualMode: jest.fn(),
        toggleGuessMode: jest.fn(),
        toggleCollapsed: jest.fn(),
        openPanel: jest.fn(),
        openSettings: jest.fn(),
        isCollapsed: jest.fn(() => over.collapsed ?? false),
        registerExternalElement: jest.fn(),
        onRefresh: jest.fn(() => jest.fn()),
    };
    const tracks = over.tracks ?? [{ name: 'English' }, { name: 'Russian' }];
    return {
        uiOwned: true,
        ui,
        retrySubtitleSearch: jest.fn(),
        langPrefs: 'langPrefs' in over ? over.langPrefs : { learning: 'en', native: 'ru' },
        state: {
            displayMode: over.displayMode ?? 'dual',
            overlayEnabled: over.overlayEnabled ?? true,
            tracks,
            hasMultipleTracks: () => over.multiple ?? true,
            // Default to the happy case (both halves found) unless a test is
            // about a missing one.
            hasLearningTrack: () => over.learningTrack ?? tracks.length > 0,
            hasNativeTrack: () => over.nativeTrack ?? tracks.length > 1,
        },
    } as any;
}

function setupBar(): void {
    document.body.innerHTML = `
        <div id="movie_player">
            <div class="ytp-right-controls"><button class="ytp-subtitles-button"></button></div>
        </div>`;
}

const menu = () => document.getElementById('vtt-ytp-menu')!;
const btn = () => document.getElementById('vtt-ytp-overlay-btn')!;
const openMenu = () => btn().dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
    lastMessage = null;
    messageReply = { signedIn: false };
    setupBar();
});

describe('installPlayerMenu', () => {
    test('mounts the button in an anchor, with the menu closed', () => {
        installPlayerMenu(makeApp());
        const anchor = document.querySelector('.vtt-ytp-anchor')!;
        expect(anchor).toBeTruthy();
        expect(anchor.contains(btn())).toBe(true);
        expect((menu() as HTMLElement).hidden).toBe(true);
        expect(btn().getAttribute('aria-expanded')).toBe('false');
        expect(btn().getAttribute('aria-haspopup')).toBe('menu');
    });

    // The menu hangs off #movie_player rather than the button: nested in the
    // bar it would be trapped in .ytp-chrome-bottom's z-index:59 context, where
    // the subtitle overlay paints over it. #movie_player is still the
    // fullscreen element, so it needs no re-parenting either way.
    test('the menu hangs off #movie_player, not the control bar', () => {
        installPlayerMenu(makeApp());
        expect(menu().parentElement!.id).toBe('movie_player');
        expect(document.querySelector('.vtt-ytp-anchor')!.contains(menu())).toBe(false);
        expect(document.getElementById('movie_player')!.contains(menu())).toBe(true);
    });

    test('a bar rebuild does not leave the old menu behind', () => {
        const app = makeApp();
        installPlayerMenu(app);
        setupBar(); // SPA navigation rebuilds the bar; the menu is not inside it
        installPlayerMenu(app);
        expect(document.querySelectorAll('#vtt-ytp-menu')).toHaveLength(1);
    });

    test('is idempotent and re-inserts after YouTube rebuilds the control bar', () => {
        const app = makeApp();
        installPlayerMenu(app);
        installPlayerMenu(app);
        expect(document.querySelectorAll('#vtt-ytp-overlay-btn')).toHaveLength(1);

        setupBar(); // SPA navigation blows the bar away
        installPlayerMenu(app);
        expect(document.querySelectorAll('#vtt-ytp-overlay-btn')).toHaveLength(1);
        expect(document.querySelector('.ytp-right-controls .vtt-ytp-anchor')).toBeTruthy();
    });

    test('does not mount when another extension copy owns the UI', () => {
        const app = makeApp();
        app.uiOwned = false;
        installPlayerMenu(app);
        expect(document.getElementById('vtt-ytp-overlay-btn')).toBeNull();
    });
});

describe('menu open/close', () => {
    test('button click toggles the menu', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect((menu() as HTMLElement).hidden).toBe(false);
        expect(btn().getAttribute('aria-expanded')).toBe('true');
        openMenu();
        expect((menu() as HTMLElement).hidden).toBe(true);
    });

    // The menu is no longer inside the anchor, so the outside-click test has to
    // check both — an anchor-only check would close it on every row click.
    test('outside mousedown closes it; a click inside does not', () => {
        installPlayerMenu(makeApp());
        openMenu();
        menu().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect((menu() as HTMLElement).hidden).toBe(false);
        document.getElementById('vtt-ytp-menu-modes')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect((menu() as HTMLElement).hidden).toBe(false);
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect((menu() as HTMLElement).hidden).toBe(true);
    });

    test('fullscreenchange closes it without persisting anything', () => {
        const app = makeApp();
        installPlayerMenu(app);
        openMenu();
        document.dispatchEvent(new Event('fullscreenchange'));
        expect((menu() as HTMLElement).hidden).toBe(true);
        expect(app.ui.toggleCollapsed).not.toHaveBeenCalled();
    });

    test('keydown inside the menu never reaches the document (YouTube binds f/k/m there)', () => {
        installPlayerMenu(makeApp());
        openMenu();
        const onDoc = jest.fn();
        document.addEventListener('keydown', onDoc);
        menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
        expect(onDoc).not.toHaveBeenCalled();
        document.removeEventListener('keydown', onDoc);
    });

    test('opening always resets to the root page', () => {
        installPlayerMenu(makeApp());
        openMenu();
        document.getElementById('vtt-ytp-menu-modes')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(menu().dataset.page).toBe('modes');
        openMenu(); // close
        openMenu(); // reopen
        expect(menu().dataset.page).toBe('root');
    });
});

describe('escape is stepwise', () => {
    const esc = () => menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    test('from the submenu it returns to root rather than closing', () => {
        installPlayerMenu(makeApp());
        openMenu();
        document.getElementById('vtt-ytp-menu-modes')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        esc();
        expect(menu().dataset.page).toBe('root');
        expect((menu() as HTMLElement).hidden).toBe(false);
    });

    test('from root it closes the menu', () => {
        installPlayerMenu(makeApp());
        openMenu();
        esc();
        expect((menu() as HTMLElement).hidden).toBe(true);
    });
});

describe('reading mode', () => {
    const checked = () =>
        Array.from(menu().querySelectorAll('[role=radio]'))
            .filter(b => b.getAttribute('aria-checked') === 'true')
            .map(b => b.id);

    test('exactly one mode is checked, matching displayMode', () => {
        installPlayerMenu(makeApp({ displayMode: 'guess' }));
        openMenu();
        expect(checked()).toEqual(['vtt-ytp-mm-guess']);
    });

    test('a displayMode outside dual/guess checks "Original only"', () => {
        installPlayerMenu(makeApp({ displayMode: 'single' }));
        openMenu();
        expect(checked()).toEqual(['vtt-ytp-mm-single']);
    });

    test('the row shows the current mode as its value', () => {
        installPlayerMenu(makeApp({ displayMode: 'dual' }));
        openMenu();
        expect(document.getElementById('vtt-ytp-menu-modes')!.textContent).toContain('Both languages');
    });

    test('picking a mode calls the sidebar and returns to root', () => {
        const app = makeApp({ displayMode: 'dual' });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-menu-modes')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.getElementById('vtt-ytp-mm-guess')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleGuessMode).toHaveBeenCalled();
        expect(menu().dataset.page).toBe('root');
    });

    test('"Original only" turns the active mode off rather than toggling a third flag', () => {
        const app = makeApp({ displayMode: 'dual' });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-mm-single')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleDualMode).toHaveBeenCalled();
        expect(app.ui.toggleGuessMode).not.toHaveBeenCalled();
    });

    test('picking the mode already active does nothing', () => {
        const app = makeApp({ displayMode: 'dual' });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-mm-dual')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleDualMode).not.toHaveBeenCalled();
    });

    test('dual is disabled without a second track', () => {
        installPlayerMenu(makeApp({ multiple: false }));
        openMenu();
        expect((document.getElementById('vtt-ytp-mm-dual') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('rows', () => {
    test('the overlay toggle is not a menu row — it is the CC button', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect(document.getElementById('vtt-ytp-menu-overlay')).toBeNull();
    });

    test('rows carry no forward chevrons', () => {
        installPlayerMenu(makeApp());
        openMenu();
        const root = menu().querySelector('.vtt-ytp-page[data-page=root]')!;
        expect(root.querySelectorAll('.vtt-ytp-chev')).toHaveLength(0);
        // The submenu keeps one — a back arrow, which points somewhere real.
        expect(document.getElementById('vtt-ytp-mm-back')!.querySelector('.vtt-ytp-chev')).toBeTruthy();
    });

    test('the panel row says Show when collapsed and Hide when open, and toggles', () => {
        const app = makeApp({ collapsed: true });
        installPlayerMenu(app);
        openMenu();
        const row = document.getElementById('vtt-ytp-menu-panel')!;
        expect(row.textContent).toContain('Show panel');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleCollapsed).toHaveBeenCalled();
        expect((menu() as HTMLElement).hidden).toBe(true);

        app.ui.isCollapsed.mockReturnValue(false);
        openMenu();
        expect(document.getElementById('vtt-ytp-menu-panel')!.textContent).toContain('Hide panel');
    });

    test('the settings row opens settings unconditionally and closes the menu', () => {
        const app = makeApp();
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-menu-settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.openSettings).toHaveBeenCalled();
        expect((menu() as HTMLElement).hidden).toBe(true);
    });

});

describe('subtitle health status', () => {
    const status = () => document.getElementById('vtt-ytp-menu-status') as HTMLButtonElement;

    test('both halves found: no status line at all', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect(status().hidden).toBe(true);
    });

    test('nothing found: says so and retries on click', () => {
        const app = makeApp({ tracks: [], learningTrack: false, nativeTrack: false });
        installPlayerMenu(app);
        openMenu();
        expect(status().hidden).toBe(false);
        expect(status().textContent).toContain('No subtitles');
        expect(status().disabled).toBe(false);

        status().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.retrySubtitleSearch).toHaveBeenCalled();
    });

    // The case that made the old blanket "No subtitles" a lie: subtitles ARE
    // playing, just not in both languages.
    test('learning track but no native track: informational, nothing to retry', () => {
        const app = makeApp({ tracks: [{ name: 'English' }], learningTrack: true, nativeTrack: false });
        installPlayerMenu(app);
        openMenu();
        expect(status().hidden).toBe(false);
        expect(status().textContent).toContain('original only');
        expect(status().textContent).not.toContain('No subtitles for this video');
        // Retrying would find nothing — the track doesn't exist.
        expect(status().disabled).toBe(true);
        status().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.retrySubtitleSearch).not.toHaveBeenCalled();
    });

    test('a partial find still leaves the CC button usable — there is something to show', () => {
        installPlayerMenu(makeApp({ tracks: [{ name: 'English' }], learningTrack: true, nativeTrack: false }));
        expect((document.getElementById('vtt-ytp-cc-btn') as HTMLButtonElement).disabled).toBe(false);
    });

    test('before languages are picked, subtitle health is not the problem', () => {
        installPlayerMenu(makeApp({ langPrefs: null, tracks: [] }));
        openMenu();
        expect(status().hidden).toBe(true);
    });
});

describe('first run (no languages picked)', () => {
    test('offers language onboarding instead of levers attached to nothing', () => {
        installPlayerMenu(makeApp({ langPrefs: null, tracks: [] }));
        openMenu();
        expect((document.getElementById('vtt-ytp-menu-onboard') as HTMLElement).hidden).toBe(false);
        expect((document.getElementById('vtt-ytp-menu-modes') as HTMLElement).hidden).toBe(true);
        // "No subtitles" would be noise before anything is configured.
        expect((document.getElementById('vtt-ytp-menu-status') as HTMLElement).hidden).toBe(true);
    });

    test('the onboarding button opens the sidebar, which owns the language pickers', () => {
        const app = makeApp({ langPrefs: null });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-menu-onboard')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.openPanel).toHaveBeenCalled();
        expect((menu() as HTMLElement).hidden).toBe(true);
    });
});

describe('CC button (the overlay toggle, split out of the menu)', () => {
    const cc = () => document.getElementById('vtt-ytp-cc-btn') as HTMLButtonElement;

    test('sits in the bar beside the mascot as one unit', () => {
        installPlayerMenu(makeApp());
        const anchor = document.querySelector('.vtt-ytp-anchor')!;
        expect(anchor.contains(cc())).toBe(true);
        expect(cc().getAttribute('role')).toBe('switch');
    });

    test('toggles the overlay and reflects its state', () => {
        const app = makeApp({ overlayEnabled: true });
        installPlayerMenu(app);
        expect(cc().getAttribute('aria-checked')).toBe('true');
        expect(cc().classList.contains('vtt-ytp-cc-btn--on')).toBe(true);

        cc().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleOverlay).toHaveBeenCalled();
    });

    test('is disabled with no track — an enabled switch that shows nothing is the bug we are fixing', () => {
        installPlayerMenu(makeApp({ tracks: [] }));
        expect(cc().disabled).toBe(true);
        expect(cc().getAttribute('aria-checked')).toBe('false');
    });

    test('is disabled before languages are picked, even though the pref defaults to on', () => {
        installPlayerMenu(makeApp({ langPrefs: null, overlayEnabled: true }));
        expect(cc().disabled).toBe(true);
        expect(cc().classList.contains('vtt-ytp-cc-btn--on')).toBe(false);
    });

    // It lives in the bar permanently, so unlike the menu it must track state
    // with nothing open: Shift+O, or a track finally loading.
    test('repaints from an onRefresh hook while the menu is closed', () => {
        const app = makeApp({ overlayEnabled: true });
        installPlayerMenu(app);
        const fire = app.ui.onRefresh.mock.calls[0][0] as () => void;
        expect(cc().classList.contains('vtt-ytp-cc-btn--on')).toBe(true);

        app.state.overlayEnabled = false; // as a Shift+O elsewhere would
        fire();
        expect(cc().classList.contains('vtt-ytp-cc-btn--on')).toBe(false);
        expect((menu() as HTMLElement).hidden).toBe(true); // nothing opened
    });

    test('un-disables itself when a track finally loads', () => {
        const app = makeApp({ tracks: [], learningTrack: false, nativeTrack: false });
        installPlayerMenu(app);
        expect(cc().disabled).toBe(true);

        app.state.tracks = [{ name: 'English' }];
        app.state.hasLearningTrack = () => true;
        (app.ui.onRefresh.mock.calls[0][0] as () => void)();
        expect(cc().disabled).toBe(false);
    });

    test('a bar rebuild drops the old subscription rather than leaking one per navigation', () => {
        const app = makeApp();
        installPlayerMenu(app);
        const unsub = app.ui.onRefresh.mock.results[0].value as jest.Mock;
        setupBar(); // SPA navigation
        installPlayerMenu(app);
        expect(unsub).toHaveBeenCalled();
    });

    test('a click on it does not reach YouTube (which would pause the video)', () => {
        installPlayerMenu(makeApp());
        const onPlayer = jest.fn();
        document.getElementById('movie_player')!.addEventListener('click', onPlayer);
        cc().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onPlayer).not.toHaveBeenCalled();
    });
});

describe('control-bar autohide', () => {
    const posts = (): any[] =>
        (window.postMessage as jest.Mock).mock.calls.map(c => c[0]).filter(m => m?.type === 'YT_WAKE_CONTROLS');

    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.useRealTimers();
        (window.postMessage as jest.Mock).mockRestore();
    });

    test('an open menu keeps the bar awake via the player API, and stops on close', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect(posts().length).toBe(1); // immediately, not after the first interval

        jest.advanceTimersByTime(4500);
        expect(posts().length).toBeGreaterThan(1);

        openMenu(); // close
        const afterClose = posts().length;
        jest.advanceTimersByTime(10000);
        expect(posts().length).toBe(afterClose); // timer cleared
    });
});

describe('leaving the page closes the menu (idle mouse does not)', () => {
    test('switching tab closes it', () => {
        installPlayerMenu(makeApp());
        openMenu();
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect((menu() as HTMLElement).hidden).toBe(true);
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

    test('switching window closes it', () => {
        installPlayerMenu(makeApp());
        openMenu();
        window.dispatchEvent(new Event('blur'));
        expect((menu() as HTMLElement).hidden).toBe(true);
    });
});

describe('account row', () => {
    test('signed out: prompts sign-in and reuses the existing auth handoff', async () => {
        installPlayerMenu(makeApp());
        openMenu();
        await Promise.resolve();
        const row = document.getElementById('vtt-ytp-menu-account')!;
        expect(row.textContent).toContain('Sign in to save words');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(lastMessage).toEqual({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM' });
    });

    test('signed in: shows email + word count and opens the site', async () => {
        messageReply = { signedIn: true, email: 'a@b.com', inboxCount: 42 };
        installPlayerMenu(makeApp());
        openMenu();
        await Promise.resolve();
        const row = document.getElementById('vtt-ytp-menu-account')!;
        expect(row.textContent).toContain('a@b.com');
        expect(row.textContent).toContain('42 words saved');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(lastMessage).toEqual({ action: 'OPEN_LINGOGRAM' });
    });

    test('account row is first — the question "am I saving anything?" leads', () => {
        installPlayerMenu(makeApp());
        openMenu();
        const root = menu().querySelector('.vtt-ytp-page[data-page=root]')!;
        expect(root.firstElementChild!.id).toBe('vtt-ytp-menu-account');
    });
});
