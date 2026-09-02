/**
 * The word screen, against a fake host.
 *
 * These moved off SidebarUI.test.ts when the screen became its own class. A
 * fake port buys precision the sidebar-level versions could not have: the
 * panel-collapse behaviour can be asserted as "it asked the host to collapse"
 * rather than inferred from a class on an element, and the takeover
 * coordination can be checked without building a settings panel to observe.
 *
 * Two tests deliberately stayed behind in SidebarUI.test.ts — the tab and the
 * settings gear — because a fake port cannot catch a mis-wired delegator, and
 * that is exactly what those two prove.
 *
 * The chrome stub and flush helper below duplicate SidebarUI.test.ts's. That
 * is the convention in this repo: every suite builds its own, and there is no
 * shared harness to reach for.
 */

// Before imports: the screen reads chrome at call time, but analytics reads
// runtime.getManifest as its module initialises.
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    storage: {
        local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
    },
    i18n: { getMessage: () => '' },
};

import { WordScreen, WordScreenHost } from '../src/lookup/word-screen';
import { LookupResult } from '../src/lookup';

const answer: LookupResult = {
    term: 'going',
    lemma: 'go',
    translations: ['идти', 'ходить'],
    parts_of_speech: [{
        tag: 'v.', label: 'Verb',
        senses: [{ translations: [], definition: 'To move from one place to another.', examples: [] }],
    }],
    source: 'wiktionary',
};

/** Two microtasks plus a macrotask — enough for the message round trip. */
const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
};

interface Harness {
    screen: WordScreen;
    host: WordScreenHost;
    sidebar: HTMLDivElement;
    panel: HTMLDivElement;
    title: HTMLHeadingElement;
    backBtn: HTMLButtonElement;
    calls: {
        openPanel: jest.Mock; collapse: jest.Mock; toggleCollapsed: jest.Mock;
        closeOtherTakeovers: jest.Mock; restoreTranscriptScroll: jest.Mock;
    };
}

function harness(over: Partial<WordScreenHost> = {}): Harness {
    document.body.innerHTML = '';
    const sidebar = document.createElement('div');
    const panel = document.createElement('div');
    const title = document.createElement('h2');
    const backBtn = document.createElement('button');
    document.body.append(sidebar, panel, title, backBtn);

    const calls = {
        openPanel: jest.fn(() => sidebar.classList.remove('collapsed')),
        collapse: jest.fn(() => sidebar.classList.add('collapsed')),
        toggleCollapsed: jest.fn(() => sidebar.classList.toggle('collapsed')),
        closeOtherTakeovers: jest.fn(),
        restoreTranscriptScroll: jest.fn(),
    };

    const host: WordScreenHost = {
        sidebar: () => sidebar,
        panel: () => panel,
        title: () => title,
        backBtn: () => backBtn,
        langPrefs: () => ({ learning: 'en', native: 'ru' }),
        isCollapsed: () => sidebar.classList.contains('collapsed'),
        ...calls,
        ...over,
    };
    return { screen: new WordScreen(host), host, sidebar, panel, title, backBtn, calls };
}

/** Answer LOOKUP_WORD with `answer`, and ADD_WORD with a success. */
function stubMessaging(result: LookupResult | null = answer): void {
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
        (msgObj: any, cb?: (r: unknown) => void) => {
            const res = msgObj?.action === 'LOOKUP_WORD'
                ? (result ? { ok: true, result } : { ok: false })
                : { ok: true, wordId: 'w1' };
            cb?.(res);
        });
}

beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    stubMessaging();
});

describe('the collapse tab while the word screen is up', () => {
    it('panel was open: the tab closes the screen and keeps the panel', () => {
        const h = harness();
        h.screen.open('main', 'the main sail');
        expect(h.sidebar.classList.contains('vtt-lookup-open')).toBe(true);

        h.screen.onToggleTab();
        expect(h.sidebar.classList.contains('vtt-lookup-open')).toBe(false);
        // The point of the fake port: "did not collapse" is now a direct
        // assertion about what the screen asked for, not an inference.
        expect(h.calls.collapse).not.toHaveBeenCalled();
    });

    it('panel was collapsed: the screen expanded it, so the tab collapses it back', () => {
        const h = harness();
        h.sidebar.classList.add('collapsed');
        h.screen.open('main', 'the main sail');
        expect(h.calls.openPanel).toHaveBeenCalled();

        h.screen.onToggleTab();
        expect(h.sidebar.classList.contains('vtt-lookup-open')).toBe(false);
        expect(h.calls.collapse).toHaveBeenCalledTimes(1);
    });

    it('a second word must not forget how the FIRST one found the panel', () => {
        const h = harness();
        h.sidebar.classList.add('collapsed');
        h.screen.open('main', 'the main sail');
        // Hovering the overlay still works over the open screen — a second
        // word re-enters open() with the panel already expanded.
        h.screen.open('sail', 'the main sail');
        h.screen.onToggleTab();
        expect(h.calls.collapse).toHaveBeenCalledTimes(1);
    });

    it('with no screen open the tab is a plain toggle', () => {
        const h = harness();
        h.screen.onToggleTab();
        expect(h.calls.toggleCollapsed).toHaveBeenCalledTimes(1);
        expect(h.calls.collapse).not.toHaveBeenCalled();
    });
});

describe('opening and closing', () => {
    it('dismisses whichever sibling takeover was up — screens never stack', () => {
        const h = harness();
        h.screen.open('main', 'the main sail');
        expect(h.calls.closeOtherTakeovers).toHaveBeenCalledTimes(1);
    });

    it('swaps the title to the word and back again', () => {
        const h = harness();
        h.screen.open('main', 'the main sail');
        expect(h.title.textContent).toBe('main');
        h.screen.close();
        expect(h.title.textContent).toBe('Subtitles');
    });

    it('catches the transcript up on close — it scrolled while the screen was up', () => {
        const h = harness();
        h.screen.open('main', 'the main sail');
        h.screen.close();
        expect(h.calls.restoreTranscriptScroll).toHaveBeenCalledTimes(1);
    });

    it('closing when nothing is open does nothing at all', () => {
        const h = harness();
        h.screen.close();
        expect(h.calls.restoreTranscriptScroll).not.toHaveBeenCalled();
    });
});

describe('the article', () => {
    it('renders the heart beside the word, and saving fills BOTH controls', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();

        const heart = h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!;
        const foot = h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!;
        expect(heart).not.toBeNull();
        expect(heart.classList.contains('saved')).toBe(false);

        heart.click();
        await flush();
        // One save, two faces: pressing either must fill both.
        expect(heart.classList.contains('saved')).toBe(true);
        expect(foot.classList.contains('saved')).toBe(true);
    });

    it('a word saved earlier comes back with the heart already filled', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();
        h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();

        h.screen.close();
        h.screen.open('going', 'we are going home');
        await flush();
        expect(h.panel.querySelector('.vtt-lookup-head-heart')!.classList.contains('saved')).toBe(true);
    });

    it('links out to Oxford when the learning language is English', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();
        const link = h.panel.querySelector<HTMLAnchorElement>('.vtt-lookup-oxford')!;
        expect(link).not.toBeNull();
        expect(link.href).toContain('/definition/english/going');
    });

    it('offers no Oxford link for a learning language it does not cover', async () => {
        const h = harness({ langPrefs: () => ({ learning: 'de', native: 'ru' }) });
        h.screen.open('gehen', 'wir gehen nach Hause');
        await flush();
        expect(h.panel.querySelector('.vtt-lookup-oxford')).toBeNull();
    });

    it('reports a failed lookup instead of rendering an empty article', async () => {
        const h = harness();
        stubMessaging(null);
        h.screen.open('going', 'we are going home');
        await flush();
        expect(h.panel.textContent).toContain("Couldn't load");
    });

    it('says so when there is no native language to translate into', async () => {
        const h = harness({ langPrefs: () => null });
        h.screen.open('going', 'we are going home');
        await flush();
        expect(h.panel.textContent).toContain("Couldn't load");
        // No point asking the service what it cannot answer.
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
});

describe('an answer that arrives too late', () => {
    // The sequence guard: closing the screen must make a response in flight
    // irrelevant, or it paints a word the reader has already navigated away
    // from — into a panel that is being torn down.
    it('renders nothing once the screen has closed', async () => {
        const h = harness();
        let deliver: ((r: unknown) => void) | undefined;
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m: any, cb?: (r: unknown) => void) => { deliver = cb; });

        h.screen.open('going', 'we are going home');
        h.screen.close();
        expect(h.panel.childElementCount).toBe(0);

        deliver?.({ ok: true, result: answer });
        await flush();
        expect(h.panel.childElementCount).toBe(0);
    });
});
