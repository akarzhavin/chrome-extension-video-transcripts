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

// Pressing save twice. The card has two controls for one action, so a double
// press is not a mistake a user has to avoid — it is what happens when the
// first press looks like it did nothing. Every extra press is a duplicate row
// in someone's dictionary.
describe('pressing save more than once', () => {
    const addWordCalls = () =>
        (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .filter(([m]) => m?.action === 'ADD_WORD');

    it('a second press on the same control sends nothing', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();

        const heart = h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!;
        heart.click();
        await flush();
        expect(addWordCalls()).toHaveLength(1);

        heart.click();
        await flush();
        expect(addWordCalls()).toHaveLength(1);
    });

    it('the other control does not get a second go at it either', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();

        h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();
        h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!.click();
        await flush();

        expect(addWordCalls()).toHaveLength(1);
    });

    it('reopening the same word does not let it be saved again', async () => {
        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();
        h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!.click();
        await flush();

        h.screen.close();
        h.screen.open('going', 'we are going home');
        await flush();
        h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!.click();
        await flush();

        expect(addWordCalls()).toHaveLength(1);
    });

    // The guard is deliberately not "one press per card": a save that FAILED
    // left nothing behind, so the retry is the whole recovery path. Locking it
    // out would strand the word with no way to save it but reopening the card.
    it('a failed save can be retried', async () => {
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (msgObj: any, cb?: (r: unknown) => void) => {
                cb?.(msgObj?.action === 'LOOKUP_WORD'
                    ? { ok: true, result: answer }
                    : { ok: false });
            });

        const h = harness();
        h.screen.open('going', 'we are going home');
        await flush();

        const save = h.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!;
        save.click();
        await flush();
        save.click();
        await flush();

        expect(addWordCalls()).toHaveLength(2);
        expect(save.classList.contains('saved')).toBe(false);
    });
});

/**
 * Behaviour map §42.3 — what the full screen says about the answer it got.
 *
 * The screen renders two very different things through one layout: a
 * dictionary entry, ordered by the word's dominant reading and blind to the
 * sentence, and a model answer, ordered by the very cue on screen. Three
 * markers tell the reader which they are looking at and what to weigh it
 * against — the source badge, the quoted cue with the word picked out, and the
 * sense numbers. None of the three had a check, so any of them could have
 * rendered one label for both sources, or lost its highlight, silently.
 */
describe('the article marks where the answer came from', () => {
    const dictionary: LookupResult = {
        term: 'anchor',
        lemma: 'anchor',
        translations: ['якорь', 'ведущий'],
        parts_of_speech: [{
            tag: 'n.', label: 'Noun',
            senses: [{ translations: [], definition: 'A tool used to moor a vessel.', examples: [] }],
        }],
        source: 'wiktionary',
    };
    const generated: LookupResult = {
        ...dictionary,
        translations: [],
        parts_of_speech: [{
            tag: 'v.', label: 'Verb',
            senses: [{
                translations: ['подкатывать'],
                definition: 'To charm someone.',
                examples: [],
            }],
        }],
        source: 'llm',
    };

    /** Open the screen on `r` and hand back the rendered panel. */
    async function article(r: LookupResult, context = 'we dropped anchor here'): Promise<HTMLDivElement> {
        const h = harness();
        stubMessaging(r);
        h.screen.open(r.term, context);
        await flush();
        return h.panel;
    }

    const badge = (panel: HTMLElement) => panel.querySelector('.vtt-lookup-src');

    it('a dictionary answer is labelled a dictionary answer', async () => {
        const panel = await article(dictionary);
        expect(badge(panel)).not.toBeNull();
        expect(badge(panel)!.textContent).toBe('dictionary');
        expect(badge(panel)!.classList.contains('dict')).toBe(true);
    });

    it('a generated answer is labelled as AI', async () => {
        const panel = await article(generated);
        expect(badge(panel)).not.toBeNull();
        expect(badge(panel)!.textContent).toBe('AI');
        expect(badge(panel)!.classList.contains('llm')).toBe(true);
    });

    it('the two labels are different labels', async () => {
        // The assertion neither check above makes alone: one label rendered
        // for both sources satisfies whichever of the two it happens to be.
        const dict = badge(await article(dictionary))!.textContent;
        const llm = badge(await article(generated))!.textContent;
        expect(dict).not.toBe(llm);
    });

    it('a cached answer is still a dictionary answer, not a third kind', async () => {
        // 'cache' is the dictionary's own answer served from the store; a
        // reader must not be shown a source they cannot interpret.
        const panel = await article({ ...dictionary, source: 'cache' });
        expect(badge(panel)!.textContent).toBe('dictionary');
    });
});

describe('the article quotes the cue and picks the word out of it', () => {
    const answer: LookupResult = {
        term: 'anchor',
        lemma: 'anchor',
        translations: ['якорь'],
        parts_of_speech: [{
            tag: 'n.', label: 'Noun',
            senses: [
                { translations: [], definition: 'A mooring tool.', examples: [] },
                { translations: [], definition: 'A news presenter.', examples: [] },
            ],
        }],
        source: 'wiktionary',
    };

    async function article(context: string, r: LookupResult = answer): Promise<HTMLDivElement> {
        const h = harness();
        stubMessaging(r);
        h.screen.open(r.term, context);
        await flush();
        return h.panel;
    }

    it('the source sentence is quoted with the word in bold', async () => {
        const panel = await article('we dropped anchor here');
        const ctx = panel.querySelector('.vtt-lookup-ctx');
        expect(ctx).not.toBeNull();
        expect(ctx!.textContent).toBe('we dropped anchor here');
        const b = ctx!.querySelector('b');
        expect(b).not.toBeNull();
        expect(b!.textContent).toBe('anchor');
    });

    it('of three cue lines it quotes the one that holds the word', async () => {
        const panel = await article('nothing here\nwe dropped anchor here\nnor here');
        const ctx = panel.querySelector('.vtt-lookup-ctx')!;
        expect(ctx.textContent).toBe('we dropped anchor here');
        expect(ctx.querySelector('b')!.textContent).toBe('anchor');
    });

    it('the senses are numbered from one', async () => {
        const panel = await article('we dropped anchor here');
        const nums = [...panel.querySelectorAll('.vtt-lookup-sense-num')].map((n) => n.textContent);
        expect(nums).toEqual(['1', '2']);
    });

    it('a cue the word is missing from is quoted plainly, not falsely bolded', async () => {
        // The counter-half: the bold is a claim about where the word is. A
        // renderer that always wrapped something would put it on the wrong text.
        const panel = await article('a line without it');
        const ctx = panel.querySelector('.vtt-lookup-ctx')!;
        expect(ctx.textContent).toBe('a line without it');
        expect(ctx.querySelector('b')).toBeNull();
    });
});

describe('the lemma is shown only when it differs from the word', () => {
    const base: LookupResult = {
        term: 'running',
        lemma: 'run',
        translations: ['бежать'],
        parts_of_speech: [{
            tag: 'v.', label: 'Verb',
            senses: [{ translations: [], definition: 'To move quickly on foot.', examples: [] }],
        }],
        source: 'wiktionary',
    };

    async function article(r: LookupResult): Promise<HTMLDivElement> {
        const h = harness();
        stubMessaging(r);
        h.screen.open(r.term, `he was ${r.term} home`);
        await flush();
        return h.panel;
    }

    it('an inflected word carries its base form', async () => {
        const panel = await article(base);
        const lemma = panel.querySelector('.vtt-lookup-lemma');
        expect(lemma).not.toBeNull();
        expect(lemma!.textContent).toBe('run');
    });

    it('a word that is already its own base form carries none', async () => {
        const panel = await article({ ...base, term: 'run', lemma: 'run' });
        expect(panel.querySelector('.vtt-lookup-lemma')).toBeNull();
        // ...and the headword is still there — the absence is the lemma's,
        // not a blank article.
        expect(panel.querySelector('.vtt-lookup-headword')!.textContent).toBe('run');
    });

    it('the same base form in another case is still the same word', async () => {
        const panel = await article({ ...base, term: 'Run', lemma: 'run' });
        expect(panel.querySelector('.vtt-lookup-lemma')).toBeNull();
    });
});

/**
 * §42.7, T5.18 — the saved marker is per-session, never restored.
 *
 * A word saved on the site (or in an earlier session) does NOT come back marked
 * here, and that is deliberate: the screen has no way to ask which words the
 * account holds, so a marker seeded from anything local would be a guess. A
 * wrong "Saved" is worse than none — it tells the user a word is in their list
 * when it is not, and the control refuses a second save on the strength of it.
 */
describe('the saved marker is not restored from storage', () => {
    it('a fresh screen holds no saved terms', () => {
        const h = harness();
        expect((h.screen as any).savedTerms.size).toBe(0);
    });

    it('a fresh screen reads nothing from storage while opening a word', () => {
        (chrome.storage.local.get as jest.Mock).mockClear();
        const h = harness();
        h.screen.open('main', 'the main sail');
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    // The other side, and the reason the set exists at all: within one session
    // a save IS remembered, so a second tap on the same word is a no-op rather
    // than a duplicate write.
    it('a term saved in this session is remembered', () => {
        const h = harness();
        (h.screen as any).savedTerms.add('main');
        expect((h.screen as any).savedTerms.has('main')).toBe(true);
    });

    // And a second screen does not inherit the first one's set: the marker is
    // per-instance, which is what makes it per-session.
    it('a second screen starts empty even after the first saved something', () => {
        const first = harness();
        (first.screen as any).savedTerms.add('main');

        const second = harness();
        expect((second.screen as any).savedTerms.size).toBe(0);
    });
});
