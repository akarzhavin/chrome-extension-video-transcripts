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

import { readFileSync } from 'fs';
import { join } from 'path';
import { installPlayerMenu } from '../src/content/player-menu';

interface FakeUi {
    toggleOverlay: jest.Mock;
    toggleDualMode: jest.Mock;
    toggleGuessMode: jest.Mock;
    setMode: jest.Mock;
    toggleCollapsed: jest.Mock;
    openPanel: jest.Mock;
    openSettings: jest.Mock;
    isCollapsed: jest.Mock;
    registerExternalElement: jest.Mock;
    onRefresh: jest.Mock;
    downloadTrack: jest.Mock;
    canDownload: jest.Mock;
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
    throttled: boolean;
    cooldownMs: number;
    failure: string;
}> = {}) {
    // Cues, not just a name: canDownload's real answer depends on a track
    // having text in it, so the default fixture carries one and a test that
    // wants the empty case passes tracks without any.
    const tracks = (over.tracks ?? [
        { name: 'English', subtitles: [{ startTime: 1, endTime: 2, text: 'hi' }] },
        { name: 'Russian', subtitles: [{ startTime: 1, endTime: 2, text: 'привет' }] },
    ]) as Array<{ name: string; subtitles?: Array<{ text: string }> }>;

    const ui: FakeUi = {
        toggleOverlay: jest.fn(),
        toggleDualMode: jest.fn(),
        toggleGuessMode: jest.fn(),
        setMode: jest.fn(),
        toggleCollapsed: jest.fn(),
        openPanel: jest.fn(),
        openSettings: jest.fn(),
        isCollapsed: jest.fn(() => over.collapsed ?? false),
        registerExternalElement: jest.fn(),
        onRefresh: jest.fn(() => jest.fn()),
        downloadTrack: jest.fn(),
        // The real predicate, not "a track object exists": a track is
        // downloadable only once it carries a cue with text, and the fixtures
        // below deliberately include tracks that have none.
        canDownload: jest.fn(() => !!tracks[0]?.subtitles?.some((s) => s.text.trim())),
    };
    return {
        uiOwned: true,
        ui,
        retrySubtitleSearch: jest.fn(),
        // Default: nothing was throttled, so the status row keeps its old
        // "no translation offered" meaning.
        cooldownRemainingMs: () => over.cooldownMs ?? 0,
        isThrottled: () => over.throttled ?? (over.cooldownMs ?? 0) > 0,
        dominantFailure: () => over.failure,
        // Mirrors app-base: throttling plus the other failures a retry could
        // clear. The menu reads this instead of hand-listing them.
        isRecoverableFailure: () =>
            (over.throttled ?? (over.cooldownMs ?? 0) > 0) ||
            ['stale-url', 'no-pot', 'network'].includes(over.failure ?? ''),
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

/**
 * The shipped English strings, read from the file the browser reads.
 *
 * The suite stubs chrome.i18n.getMessage to '' so t() falls through to the
 * source literal — which means an assertion made under that stub pins the
 * FALLBACK, and messages.json could say something else forever. Tests that care
 * what the user reads install this instead.
 */
const EN_MESSAGES: Record<string, { message: string }> = JSON.parse(
    readFileSync(join(__dirname, '..', '_locales', 'en', 'messages.json'), 'utf8'),
);
const withShippedStrings = (body: () => void): void => {
    const original = chrome.i18n.getMessage;
    (chrome.i18n as any).getMessage = (key: string) => EN_MESSAGES[key]?.message ?? '';
    try {
        body();
    } finally {
        (chrome.i18n as any).getMessage = original;
    }
};

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

    /**
     * The two controls the product puts in YouTube's own bar say what they are.
     * Nothing read either title before: the only assertion in the tree carrying
     * "(Shift+O)" is app-base-status.test.ts's 'On-screen (Shift+O)', which is
     * the SIDEBAR chip — a different element, a different key, different text.
     * Do not delete these as duplicates of it.
     *
     * Asserted against the SHIPPED strings, not the source fallbacks: t()
     * returns the fallback under this suite's i18n stub, so a check made under
     * the stub would stay green while messages.json drifted. Reading the file
     * the browser reads makes either side drifting go red.
     */
    test('the bar button names the product in its tooltip', () => {
        withShippedStrings(() => {
            installPlayerMenu(makeApp());
            expect(btn().title).toBe('Lingogram menu');
            // One key, two attributes (player-menu.ts:177 and :798). Asserting
            // one leaves the claim half-true if the other is dropped.
            expect(menu().getAttribute('aria-label')).toBe('Lingogram menu');
        });
    });

    test('the captions button says what it does and which key reaches it', () => {
        withShippedStrings(() => {
            installPlayerMenu(makeApp());
            const cc = document.getElementById('vtt-ytp-cc-btn') as HTMLElement;
            // The shortcut suffix is composed in code and governed by no locale
            // file, so it is the half most able to drift unnoticed.
            expect(cc.title).toBe('Subtitles on video (Shift+O)');
        });
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
    // menuitemradio, not radio: the rows live inside role="menu", where the
    // plain radio role is invalid (it wants a radiogroup parent).
    const checked = () =>
        Array.from(menu().querySelectorAll('[role=menuitemradio]'))
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
        expect(app.ui.setMode).toHaveBeenCalledWith('guess');
        expect(menu().dataset.page).toBe('root');
    });

    test('"Original only" is a direct pick, not a toggle workaround', () => {
        const app = makeApp({ displayMode: 'dual' });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-mm-single')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.setMode).toHaveBeenCalledWith('single');
        expect(app.ui.toggleDualMode).not.toHaveBeenCalled();
        expect(app.ui.toggleGuessMode).not.toHaveBeenCalled();
    });

    test('picking the mode already active is a no-op pick (setMode dedupes)', () => {
        const app = makeApp({ displayMode: 'dual' });
        installPlayerMenu(app);
        openMenu();
        document.getElementById('vtt-ytp-mm-dual')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        // The dedupe lives in AppState.setDisplayMode now; the menu just picks.
        expect(app.ui.setMode).toHaveBeenCalledWith('dual');
    });

    test('dual is disabled without a second track', () => {
        installPlayerMenu(makeApp({ multiple: false }));
        openMenu();
        expect((document.getElementById('vtt-ytp-mm-dual') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('rows', () => {
    const overlayRow = () => document.getElementById('vtt-ytp-menu-overlay') as HTMLButtonElement;

    test('the on-screen row is a switch that reflects the overlay state', () => {
        installPlayerMenu(makeApp({ overlayEnabled: true }));
        openMenu();
        expect(overlayRow().getAttribute('role')).toBe('menuitemcheckbox');
        expect(overlayRow().getAttribute('aria-checked')).toBe('true');
    });

    test('clicking it toggles the overlay and keeps the menu open', () => {
        const app = makeApp({ overlayEnabled: true });
        // The real toggleOverlay flips state; the menu repaints from it.
        app.ui.toggleOverlay.mockImplementation(() => {
            app.state.overlayEnabled = !app.state.overlayEnabled;
        });
        installPlayerMenu(app);
        openMenu();
        overlayRow().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.toggleOverlay).toHaveBeenCalled();
        // A switch answers in place — closing would hide the very state change
        // the click asked for.
        expect((menu() as HTMLElement).hidden).toBe(false);
        expect(overlayRow().getAttribute('aria-checked')).toBe('false');
    });

    test('the on-screen row is disabled with no track, like the CC button', () => {
        installPlayerMenu(makeApp({ tracks: [], learningTrack: false, nativeTrack: false }));
        openMenu();
        expect(overlayRow().disabled).toBe(true);
        expect(overlayRow().getAttribute('aria-checked')).toBe('false');
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

    test('the download row downloads and closes the menu', () => {
        const app = makeApp();
        installPlayerMenu(app);
        openMenu();
        const row = document.getElementById('vtt-ytp-menu-download') as HTMLButtonElement;
        expect(row.disabled).toBe(false);
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.downloadTrack).toHaveBeenCalled();
        // Unlike the toggles above, the result is a file, not something to look
        // at behind the menu.
        expect((menu() as HTMLElement).hidden).toBe(true);
    });

    test('a track with no cues leaves the row present but inert', () => {
        // The row goes quiet rather than vanishing, so the menu's shape does
        // not shift as tracks arrive.
        const app = makeApp({ tracks: [{ name: 'English', subtitles: [] }] });
        installPlayerMenu(app);
        openMenu();
        const row = document.getElementById('vtt-ytp-menu-download') as HTMLButtonElement;
        expect(row.hidden).toBe(false);
        expect(row.disabled).toBe(true);
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.ui.downloadTrack).not.toHaveBeenCalled();
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
        // The WHOLE line, not the prefix. 'No subtitles' is shared with
        // ytMenuNoTranslation ("No subtitles in your language — original
        // only"), so the old prefix match stayed green when this arm rendered
        // the other message — the exact confusion the check below exists for.
        expect(status().textContent).toContain('No subtitles for this video');
        expect(status().textContent).not.toContain('original only');
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

    // Same visible shape as the case above (one track playing, one missing) but
    // a different cause, and the difference is the whole point: a throttled
    // translation can be retried, an unoffered one cannot.
    test('native track throttled: says so and offers a retry', () => {
        const app = makeApp({
            tracks: [{ name: 'English' }],
            learningTrack: true,
            nativeTrack: false,
            throttled: true,
        });
        installPlayerMenu(app);
        openMenu();
        expect(status().hidden).toBe(false);
        expect(status().textContent).toContain('limited by YouTube');
        expect(status().textContent).not.toContain('original only');
        // Stays a quiet info row: subtitles are playing, this is not an alarm.
        expect(status().classList.contains('vtt-ytp-row--status-info')).toBe(true);
        expect(status().disabled).toBe(false);

        status().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(app.retrySubtitleSearch).toHaveBeenCalled();
    });

    // An expired signed URL is a load failure, not an absent translation —
    // it must not borrow the "original only" wording, which says the opposite.
    test('an expired link is retryable, not reported as "original only"', () => {
        const app = makeApp({
            tracks: [{ name: 'English' }],
            learningTrack: true,
            nativeTrack: false,
            failure: 'stale-url',
        });
        installPlayerMenu(app);
        openMenu();
        expect(status().textContent).not.toContain('original only');
        expect(status().disabled).toBe(false);
    });

    /**
     * The countdown is LIVE — the number falls while the menu stays open.
     * Its neighbour below renders one frame and reads '12s', which a product
     * with no interval at all also produces; the ticking itself was unpinned.
     *
     * makeApp's cooldownRemainingMs is a constant closure, so the remaining
     * time is overridden here with a mutable one — advancing a fake clock alone
     * would re-render the same number forever and prove nothing.
     */
    test('the countdown ticks while the menu is open, and stops when it closes', () => {
        jest.useFakeTimers();
        try {
            const app = makeApp({
                tracks: [{ name: 'English' }],
                learningTrack: true,
                nativeTrack: false,
                cooldownMs: 12_000,
            });
            let remaining = 12_000;
            app.cooldownRemainingMs = () => remaining;
            installPlayerMenu(app);
            openMenu();
            expect(status().textContent).toContain('12s');

            // Never step to 0: the tick is conditional on remaining > 0, so a
            // countdown that reached zero would stop re-rendering and leave the
            // last number up — passing for the wrong reason.
            remaining = 9_000;
            jest.advanceTimersByTime(3_000);
            expect(status().textContent).toContain('9s');
            expect(status().textContent).not.toContain('12s');

            // Closing must stop it — nobody can read a countdown they cannot
            // see, and a live interval on a closed menu is a leak. Asserted
            // after close(), not while open: open() also runs a wake timer.
            btn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('while the cooldown runs the row counts down and cannot be clicked', () => {
        const app = makeApp({
            tracks: [{ name: 'English' }],
            learningTrack: true,
            nativeTrack: false,
            cooldownMs: 12_000,
        });
        installPlayerMenu(app);
        openMenu();
        expect(status().textContent).toContain('12s');
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
        expect((document.getElementById('vtt-ytp-menu-overlay') as HTMLElement).hidden).toBe(true);
        // "No subtitles" would be noise before anything is configured.
        expect((document.getElementById('vtt-ytp-menu-status') as HTMLElement).hidden).toBe(true);
        // The other two rows of the same block (player-menu.ts:510-515). Keep
        // them HERE, in the langPrefs:null fixture: the neighbouring check at
        // 'a track with no cues leaves the row present but inert' asserts
        // hidden === false on this same element for the canDownload() path, so
        // merging the two would quietly delete the noLangs half.
        expect((document.getElementById('vtt-ytp-menu-download') as HTMLElement).hidden).toBe(true);
        expect((document.getElementById('vtt-ytp-menu-settings') as HTMLElement).hidden).toBe(true);
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
        // `from` labels which surface converted the sign-in, for the funnel.
        expect(lastMessage).toEqual({
            action: 'AUTH_SIGN_IN_VIA_LINGOGRAM',
            from: 'player_menu',
        });
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

// A player-less page (home/search/channel) is not a rebuild: there is no bar to
// re-insert into, so nothing carries the teardown or retires the retry unless
// install does it itself. installPlayerMenu runs on EVERY yt-navigate-finish.
describe('navigation without a player', () => {
    const noBar = () => { document.body.innerHTML = `<div id="movie_player"></div>`; };

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('repeated installs leave only one retry timer running', () => {
        const setSpy = jest.spyOn(global, 'setInterval');
        const clearSpy = jest.spyOn(global, 'clearInterval');
        noBar();

        for (let i = 0; i < 5; i++) installPlayerMenu(makeApp());

        // Count LIVE timers (armed minus cleared), not cumulative arms: re-arming
        // after clearing the previous is the intended shape, and it calls
        // setInterval each time. Five browsed pages used to mean five concurrent
        // pollers, each hitting the DOM 5x/s for 30s.
        const live = setSpy.mock.results
            .map((r) => r.value)
            .filter((id) => !clearSpy.mock.calls.some(([c]) => c === id));
        expect(live).toHaveLength(1);
        setSpy.mockRestore();
        clearSpy.mockRestore();
    });

    test('leaving a watch page drops the old menu subscription', () => {
        const unsub = jest.fn();
        const app = makeApp();
        app.ui.onRefresh = jest.fn(() => unsub);

        installPlayerMenu(app);          // watch page: mounts
        noBar();                         // → home: bar gone, nothing to re-insert
        installPlayerMenu(app);

        // Without this the hook survives on a detached button and SidebarUI
        // .refresh() paints it forever — one orphan per round trip.
        expect(unsub).toHaveBeenCalled();
    });
});

// uiOwned is the two-copies guard (an old CWS build + a dev build share #vtt-*
// ids). It can flip to true after install — reporting "inserted" while not
// owning the UI retires the retry and the button never appears.
test('an install made while a second copy owns the UI retries once it lets go', () => {
    jest.useFakeTimers();
    const app = makeApp();
    app.uiOwned = false;

    installPlayerMenu(app);
    expect(document.getElementById('vtt-ytp-overlay-btn')).toBeNull();

    app.uiOwned = true;
    jest.advanceTimersByTime(5000);
    expect(document.getElementById('vtt-ytp-overlay-btn')).toBeTruthy();
    jest.useRealTimers();
});

// role="menu" only maps to a menu for assistive tech if its children are
// menuitems; arrow keys — not Tab — are how a menu is walked.
describe('keyboard and ARIA', () => {
    const items = () => Array.from(
        menu().querySelectorAll<HTMLButtonElement>('.vtt-ytp-page[data-page=root] [role^=menuitem]'))
        .filter((el) => !el.hidden && !el.disabled);
    const key = (k: string) =>
        menu().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

    test('rows are menuitems and the menu is reachable', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect(items().length).toBeGreaterThan(0);
        expect(menu().getAttribute('role')).toBe('menu');
    });

    test('opening moves focus to the first row', () => {
        installPlayerMenu(makeApp());
        openMenu();
        expect(document.activeElement).toBe(items()[0]);
    });

    test('arrows walk the rows and wrap', () => {
        installPlayerMenu(makeApp());
        openMenu();
        const rows = items();

        key('ArrowDown');
        expect(document.activeElement).toBe(rows[1]);
        key('ArrowUp');
        expect(document.activeElement).toBe(rows[0]);
        key('ArrowUp'); // wraps to the end
        expect(document.activeElement).toBe(rows[rows.length - 1]);
    });

    test('Home and End jump to the ends', () => {
        installPlayerMenu(makeApp());
        openMenu();
        const rows = items();
        key('End');
        expect(document.activeElement).toBe(rows[rows.length - 1]);
        key('Home');
        expect(document.activeElement).toBe(rows[0]);
    });

    // Roving tabindex: Tab leaves the menu, arrows walk it. Two tabbable rows
    // would put the menu in the page's tab order twice.
    test('exactly one row is tabbable, and it is the focused one', () => {
        installPlayerMenu(makeApp());
        openMenu();
        key('ArrowDown');
        const tabbable = items().filter((el) => el.tabIndex === 0);
        expect(tabbable).toEqual([document.activeElement]);
    });

    test('focus follows the page switch into the submenu and back', () => {
        installPlayerMenu(makeApp());
        openMenu();
        document.getElementById('vtt-ytp-menu-modes')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        // Focus must not stay on a row that is now display:none.
        expect(menu().querySelector('.vtt-ytp-page[data-page=modes]')!
            .contains(document.activeElement)).toBe(true);

        key('Escape');   // stepwise: back to root, focus returns to its row
        expect(document.activeElement!.id).toBe('vtt-ytp-menu-modes');
    });
});

// Where the control sits in YouTube's own bar — behaviour map §9.2. The
// existing checks confirm it lands somewhere inside .ytp-right-controls; the
// claim is narrower than that, and the reason is discoverability. Beside the
// captions button it reads as "the other subtitle control". Pushed to the end
// of the bar it sits past fullscreen, where nobody looking for subtitles goes.
describe('where the control sits in the player bar', () => {
    const anchor = () => document.querySelector<HTMLElement>('.vtt-ytp-anchor')!;
    const cc = () => document.querySelector<HTMLElement>('.ytp-subtitles-button')!;

    test('it is the captions button\'s immediate left-hand sibling', () => {
        installPlayerMenu(makeApp());
        expect(anchor().nextElementSibling).toBe(cc());
        expect(cc().previousElementSibling).toBe(anchor());
    });

    // YouTube nests the row a level deeper in some layouts, so the captions
    // button is not always a direct child of .ytp-right-controls. Inserting
    // against the wrapper instead of the button's own parent puts the control
    // outside the group it belongs to.
    test('it follows the captions button into a nested layout', () => {
        document.body.innerHTML = `
            <div id="movie_player">
                <div class="ytp-right-controls">
                    <div class="ytp-right-controls-left">
                        <button class="ytp-subtitles-button"></button>
                    </div>
                    <button class="ytp-fullscreen-button"></button>
                </div>
            </div>`;
        installPlayerMenu(makeApp());

        expect(anchor().parentElement).toBe(cc().parentElement);
        expect(anchor().nextElementSibling).toBe(cc());
    });

    // No captions button this session: the control still has to appear. Being
    // in the wrong place beats not being there at all.
    test('with no captions button it still reaches the bar', () => {
        document.body.innerHTML = `
            <div id="movie_player">
                <div class="ytp-right-controls"><button class="ytp-fullscreen-button"></button></div>
            </div>`;
        installPlayerMenu(makeApp());

        const controls = document.querySelector('.ytp-right-controls')!;
        expect(controls.contains(anchor())).toBe(true);
    });

    test('with no control bar at all, nothing is inserted and nothing throws', () => {
        document.body.innerHTML = '<div id="movie_player"></div>';
        expect(() => installPlayerMenu(makeApp())).not.toThrow();
        expect(document.querySelector('.vtt-ytp-anchor')).toBeNull();
    });
});
