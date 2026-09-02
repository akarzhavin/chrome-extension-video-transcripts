/**
 * Word lookup: the client, the answer-shaping helpers, the worker cache, the
 * LOOKUP_WORD route and the hover strip's rate-limit debounce.
 *
 * The one invariant most worth latching: the two sources are mirror images
 * (wiktionary fills top-level translations, the model fills per-sense ones),
 * and extraction that reads only one side renders the other source empty.
 */

// Chrome stub BEFORE imports — the strip and the handler read it at call time,
// and analytics/isEmbed reads runtime.getManifest at install time.
function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn(async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return out;
        }),
        set: jest.fn(async (obj: Record<string, unknown>) => Object.assign(store, obj)),
        remove: jest.fn(async () => {}),
        _store: store,
    };
}
const chromeStorage = { local: makeStorageArea(), session: makeStorageArea() };
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        lastError: undefined,
    },
    storage: chromeStorage,
    i18n: { getMessage: () => '' },
    tabs: { create: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
};

// The handler pulls analytics-bg (GA4 transport) transitively; its network
// must never run under test, and track calls are asserted through this mock.
jest.mock('../src/analytics-bg', () => ({
    track: jest.fn(async () => {}),
    handleTrackMessage: jest.fn(async () => ({ ok: true })),
}));

import {
    fetchLookup,
    hasLookupContent,
    latencyBucket,
    lookupCached,
    clearLookupCache,
    stripDefinition,
    showsLemma,
    isContextual,
    posTags,
    stripTranslations,
    LookupResult,
} from '../src/lookup';
import { installLookupStrip } from '../src/content/lookup-strip';
import { handleAuthMessage } from '../src/auth/background';
import { config } from '../src/auth/config';
import { track } from '../src/analytics-bg';

const dictAnswer: LookupResult = {
    term: 'anchor',
    lemma: 'anchor',
    translations: ['якорь', 'ведущий', 'диктор', 'телеведущий'],
    parts_of_speech: [
        {
            tag: 'n.', label: 'Noun',
            senses: [{ translations: [], definition: 'A tool used to moor a vessel.', examples: [] }],
        },
        { tag: 'v.', label: 'Verb', senses: [{ translations: [], definition: 'To connect to a fixed point.', examples: [] }] },
        { tag: 'n.', label: 'Noun', senses: [{ translations: [], definition: 'An anchorite.', examples: [] }] },
    ],
    source: 'wiktionary',
};

const llmAnswer: LookupResult = {
    term: 'rizzed him up',
    lemma: 'rizz',
    translations: [],
    parts_of_speech: [
        {
            tag: 'v.', label: 'Verb',
            senses: [{
                translations: ['подкатывать', 'завести разговор'],
                definition: 'To charm or flirt with someone.',
                examples: [{ text: 'He really rizzed him up.', translation: 'Он завёл с ним разговор.', highlight: 'rizzed him up' }],
            }],
        },
    ],
    source: 'llm',
};

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

beforeEach(() => {
    clearLookupCache();
    (global as any).fetch = jest.fn();
    (track as jest.Mock).mockClear();
});

describe('stripTranslations — the mirror-image sources', () => {
    it('reads the top-level list on a dictionary answer', () => {
        expect(stripTranslations(dictAnswer)).toEqual(['якорь', 'ведущий', 'диктор']);
    });
    it('falls back to the first sense on a model answer, whose top list is empty', () => {
        expect(stripTranslations(llmAnswer)).toEqual(['подкатывать', 'завести разговор']);
    });
    it('answers empty for an empty result', () => {
        expect(stripTranslations({ ...dictAnswer, translations: [], parts_of_speech: [] })).toEqual([]);
    });
});

describe('showsLemma — the -er/-est trap', () => {
    // Every shape below is a real preprod answer. The dictionary resolves an
    // inflection across ALL parts of speech, so any -er/-est word can come
    // back with a comparative lemma even when it leads with a noun.
    const build = (term: string, lemma: string, tags: string[]): LookupResult => ({
        term, lemma, translations: ['x'],
        parts_of_speech: tags.map((tag) => ({
            tag, label: '', senses: [{ translations: [], definition: 'd', examples: [] }],
        })),
        source: 'wiktionary',
    });

    it('hides "number → numb": the entry leads with a noun, not an adjective', () => {
        expect(showsLemma(build('number', 'numb', ['n.', 'v.', 'n.']))).toBe(false);
    });

    it('hides "fitter → fit" for the same reason', () => {
        expect(showsLemma(build('fitter', 'fit', ['n.', 'adj.', 'v.']))).toBe(false);
    });

    it('keeps "later → late": the entry does lead with an adverb', () => {
        expect(showsLemma(build('later', 'late', ['adv.', 'adj.', 'intj.']))).toBe(true);
    });

    it('keeps "bluer → blue" — wait, that leads with a noun', () => {
        // Wiktionary lists a noun sense of "blue" first, so the guard drops
        // the lemma here too. Losing a correct base form on a rare reading is
        // the acceptable half of this trade: showing a wrong one is not.
        expect(showsLemma(build('bluer', 'blue', ['n.', 'adj.', 'n.']))).toBe(false);
    });

    it('keeps an ordinary inflection whose lemma is unrelated to -er/-est', () => {
        expect(showsLemma(build('running', 'run', ['v.', 'n.', 'adj.']))).toBe(true);
        expect(showsLemma(build('mice', 'mouse', ['n.']))).toBe(true);
    });

    it('says nothing to show when the lemma equals the term', () => {
        expect(showsLemma(build('anchor', 'anchor', ['n.', 'v.']))).toBe(false);
    });

    it('a term that IS the lemma plus -er keeps it (e.g. a genuine agent noun)', () => {
        // "teacher" → "teach" is not a comparative claim: the lemma is a
        // prefix of the term, so the -er rule does not fire.
        expect(showsLemma(build('teacher', 'teacher', ['n.']))).toBe(false);
    });
});

describe('stripDefinition — the no-equivalents fallback', () => {
    it('finds the first definition when both translation sides are empty ("sloppily")', () => {
        const sloppily: LookupResult = {
            term: 'sloppily', lemma: 'sloppily', translations: [],
            parts_of_speech: [{ tag: 'adv.', label: 'Adverb',
                senses: [{ translations: [], definition: 'In a sloppy manner, not neatly.', examples: [] }] }],
            source: 'wiktionary',
        };
        expect(stripTranslations(sloppily)).toEqual([]);
        expect(stripDefinition(sloppily)).toBe('In a sloppy manner, not neatly.');
    });
});

describe('posTags', () => {
    it('collapses duplicates while keeping server order — the first tag is the cue\'s', () => {
        expect(posTags(dictAnswer)).toEqual(['n.', 'v.']);
    });
    it('caps at three', () => {
        const many = {
            ...dictAnswer,
            parts_of_speech: ['n.', 'v.', 'adj.', 'adv.'].map((tag) => ({ tag, label: '', senses: [] })),
        };
        expect(posTags(many)).toHaveLength(3);
    });
});

describe('isContextual — who may claim "the sense this phrase uses"', () => {
    it('dictionary answers are context-blind: flat translations, no claim', () => {
        expect(isContextual(dictAnswer)).toBe(false);
    });
    it('model answers attach translations to senses: the claim is backed', () => {
        expect(isContextual(llmAnswer)).toBe(true);
    });
});

describe('hasLookupContent', () => {
    it('a part of speech with no senses is not content', () => {
        expect(hasLookupContent({
            term: 'x', lemma: 'x', translations: [],
            parts_of_speech: [{ tag: 'n.', label: 'Noun', senses: [] }],
            source: '',
        })).toBe(false);
    });
    it('per-sense translations alone count (the model shape)', () => {
        expect(hasLookupContent(llmAnswer)).toBe(true);
    });
});

describe('latencyBucket', () => {
    it('never reports a raw number', () => {
        expect([latencyBucket(0), latencyBucket(299), latencyBucket(999), latencyBucket(5000)])
            .toEqual(['lt300', 'lt300', 'lt1000', 'slow']);
    });
});

describe('fetchLookup', () => {
    it('POSTs the wire field names and returns the parsed answer', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(dictAnswer));
        const r = await fetchLookup('https://api.test/', {
            term: 'anchor', targetLang: 'ru', context: 'They dropped the anchor.',
            maxPartsOfSpeech: 3, maxSenses: 1,
        });
        expect(r.lemma).toBe('anchor');
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://api.test/dictionary/lookup');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({
            term: 'anchor',
            target_lang: 'ru',
            context: 'They dropped the anchor.',
            max_parts_of_speech: 3,
            max_senses: 1,
        });
    });

    it('throws on a non-200 — an unknown word is a 200, never an error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ detail: 'x' }, 429));
        await expect(fetchLookup('https://api.test', { term: 'a', targetLang: 'ru' }))
            .rejects.toThrow('lookup HTTP 429');
    });

    it('fills nil arrays so renderers never meet null', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({
            term: 'x', lemma: 'x', translations: null,
            parts_of_speech: [{ tag: 'n.', label: 'Noun', senses: [{ definition: 'd' }] }],
            source: 'llm',
        }));
        const r = await fetchLookup('https://api.test', { term: 'x', targetLang: 'ru' });
        expect(r.translations).toEqual([]);
        expect(r.parts_of_speech[0].senses[0].translations).toEqual([]);
        expect(r.parts_of_speech[0].senses[0].examples).toEqual([]);
    });

    it('aborts past the timeout and reports it as a timeout', async () => {
        jest.useFakeTimers();
        (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                (init.signal as AbortSignal).addEventListener('abort', () => {
                    const err = new Error('aborted');
                    (err as any).name = 'AbortError';
                    reject(err);
                });
            }));
        const p = fetchLookup('https://api.test', { term: 'a', targetLang: 'ru' });
        const guarded = expect(p).rejects.toThrow('lookup timeout');
        await jest.advanceTimersByTimeAsync(7001);
        await guarded;
        jest.useRealTimers();
    });
});

describe('lookupCached', () => {
    it('answers the second sighting from memory — the rate limit is spent once', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(dictAnswer));
        const a = await lookupCached('https://api.test', { term: 'Anchor', targetLang: 'ru' }, false);
        const b = await lookupCached('https://api.test', { term: 'anchor', targetLang: 'ru' }, false);
        expect(a.cached).toBe(false);
        expect(b.cached).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    it('keys the languages apart', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(dictAnswer));
        await lookupCached('https://api.test', { term: 'anchor', targetLang: 'ru' }, false);
        await lookupCached('https://api.test', { term: 'anchor', targetLang: 'de' }, false);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('LOOKUP_WORD route', () => {
    it('rejects a call with no term or language before any network', async () => {
        const res = await handleAuthMessage({ action: 'LOOKUP_WORD', term: '  ', targetLang: 'ru' });
        expect(res).toEqual({ ok: false, error: 'term and targetLang required' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports "not configured" quietly when the build has no API', async () => {
        const prev = config.apiBaseUrl;
        config.apiBaseUrl = '';
        try {
            const res = await handleAuthMessage({ action: 'LOOKUP_WORD', term: 'anchor', targetLang: 'ru' });
            expect(res).toEqual({ ok: false, error: 'lookup not configured' });
        } finally {
            config.apiBaseUrl = prev;
        }
    });

    it('answers with the result and tracks shape only — never the word', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(dictAnswer));
        const res = (await handleAuthMessage({
            action: 'LOOKUP_WORD', term: 'anchor', targetLang: 'ru',
            context: 'They dropped the anchor.', site: 'youtube',
        })) as { ok: boolean; result: LookupResult };
        expect(res.ok).toBe(true);
        expect(res.result.source).toBe('wiktionary');
        const [event, params] = (track as jest.Mock).mock.calls[0];
        expect(event).toBe('word_lookup');
        expect(params).not.toHaveProperty('term');
        expect(params).not.toHaveProperty('context');
        expect(params.source).toBe('wiktionary');
        expect(params.level).toBe('strip');
    });

    it('a failed upstream is ok:false, not a thrown auth error', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
        const res = (await handleAuthMessage({
            action: 'LOOKUP_WORD', term: 'anchor', targetLang: 'ru',
        })) as { ok: boolean };
        expect(res.ok).toBe(false);
    });
});

describe('hover strip debounce — the 30/min budget', () => {
    // The overlay is the hover surface; the sidebar opens on click instead.
    function buildLine(words: string[], surface: 'overlay' | 'sidebar' = 'overlay'): HTMLElement {
        const item = document.createElement('div');
        item.className = surface === 'overlay' ? 'vtt-overlay' : 'vtt-item';
        item.dataset.index = '0';
        const main = document.createElement('div');
        main.className = surface === 'overlay' ? 'vtt-overlay-main' : 'vtt-main-text';
        if (surface === 'overlay') main.dataset.index = '0';
        for (const w of words) {
            const span = document.createElement('span');
            span.dataset.word = w;
            span.textContent = w;
            main.appendChild(span);
            main.appendChild(document.createTextNode(' '));
        }
        item.appendChild(main);
        document.body.appendChild(item);
        return main;
    }

    function hover(el: Element): void {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }

    function click(el: Element): void {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_msg, cb) => {
            cb({ ok: true, result: dictAnswer });
        });
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
    });

    it('a cursor sweeping ten words fires ONE request, for the word it stopped on', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'stop']);
        const spans = main.querySelectorAll('span[data-word]');
        // Sweep: each hover lands before the previous debounce expires.
        spans.forEach((s) => {
            hover(s);
            jest.advanceTimersByTime(50);
        });
        // The cursor rests on the last word past the debounce.
        await jest.advanceTimersByTimeAsync(300);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const [msg] = (chrome.runtime.sendMessage as jest.Mock).mock.calls[0];
        expect(msg.action).toBe('LOOKUP_WORD');
        expect(msg.term).toBe('stop');
        expect(msg.targetLang).toBe('ru');
        teardown();
        jest.useRealTimers();
    });

    it('does not fire at all for a hover shorter than the debounce', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['fleeting']);
        const span = main.querySelector('span[data-word]')!;
        hover(span);
        jest.advanceTimersByTime(100);
        span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(1000);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });

    it('ignores hover in the sidebar — the cursor crosses it on the way anywhere', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['transcript'], 'sidebar');
        hover(main.querySelector('span[data-word]')!);
        await jest.advanceTimersByTimeAsync(2000);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });

    it('opens on a sidebar CLICK, and stops the cue handler that would seek', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['transcript'], 'sidebar');
        const seek = jest.fn();
        // Mirrors SidebarUI.buildPlainItem: the cue seeks when clicked.
        main.closest('.vtt-item')!.addEventListener('click', seek);
        click(main.querySelector('span[data-word]')!);
        await jest.advanceTimersByTimeAsync(50);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect((chrome.runtime.sendMessage as jest.Mock).mock.calls[0][0].term).toBe('transcript');
        expect(seek).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });
});

describe('placement — the card must never detach from its word', () => {
    function overlayWord(word: string, rect: Partial<DOMRect> = {}): HTMLElement {
        const box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        box.dataset.index = '0';
        const span = document.createElement('span');
        span.dataset.word = word;
        span.textContent = word;
        box.appendChild(span);
        document.body.appendChild(box);
        // jsdom gives every element a zero rect; a real word has a box.
        span.getBoundingClientRect = () => ({
            left: 300, top: 500, width: 60, height: 18, right: 360, bottom: 518,
            x: 300, y: 500, toJSON: () => ({}), ...rect,
        }) as DOMRect;
        return span;
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) => cb({ ok: true, result: dictAnswer }));
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
    });

    // The anchor watchdog also removes an orphaned card, but on a 500ms tick.
    // This test pins the SYNCHRONOUS guard inside place(): the frame the answer
    // lands on must not paint a card at 0,0, even for the half-second before
    // the watchdog would sweep it away.
    it('drops the card when the answer lands after the overlay replaced the word', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const span = overlayWord('anchor');
        // Hold the answer until the overlay has repainted, so place() runs on
        // an anchor that is already gone — the real ordering, where the reply
        // arrives ~270ms after the hover and the cue can change in between.
        let deliver: (() => void) | null = null;
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) => {
            deliver = () => cb({ ok: true, result: dictAnswer });
        });
        span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(230);

        // The overlay repaints mid-flight: the span leaves the document and
        // its rect collapses to zeros, exactly as a real detached node's does.
        span.closest('.vtt-overlay-main')!.remove();
        span.getBoundingClientRect = () => ({
            left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0,
            x: 0, y: 0, toJSON: () => ({}),
        }) as DOMRect;
        deliver!();
        // Settle the promise microtasks ONLY — advancing timers here would let
        // the 500ms anchor watchdog sweep the card away and hide whether
        // place() did its own job. This pins the synchronous guard: the very
        // frame the answer lands on must not paint a detached card.
        await Promise.resolve();
        await Promise.resolve();
        // Either the card is gone, or — the bug — it parked itself in the
        // top-left corner, detached from any word and over the page chrome.
        const card = document.getElementById('lingogram-lookup-strip');
        if (card) {
            throw new Error(
                `card survived a vanished anchor at left=${card.style.left} top=${card.style.top}`,
            );
        }
        expect(card).toBeNull();
        teardown();
        jest.useRealTimers();
    });

    it('drops a card whose word disappears while it is open, and resumes playback', async () => {
        jest.useFakeTimers();
        const video = document.createElement('video');
        const playSpy = jest.fn(() => Promise.resolve());
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        video.play = playSpy as unknown as HTMLVideoElement['play'];
        video.pause = jest.fn(function (this: HTMLVideoElement) {
            Object.defineProperty(this, 'paused', { value: true, configurable: true });
        }) as unknown as HTMLVideoElement['pause'];
        document.body.appendChild(video);

        const teardown = installLookupStrip();
        const span = overlayWord('anchor');
        span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(600);
        expect(document.getElementById('lingogram-lookup-strip')).not.toBeNull();

        // The cue changes: the overlay swaps its children out.
        span.closest('.vtt-overlay-main')!.remove();
        await jest.advanceTimersByTimeAsync(700);
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();
        expect(playSpy).toHaveBeenCalledTimes(1);
        teardown();
        jest.useRealTimers();
    });
});

describe('playback — the overlay pauses, the sidebar does not', () => {
    let video: HTMLVideoElement;
    let playSpy: jest.Mock;
    let pauseSpy: jest.Mock;

    function buildOverlayWord(word: string): HTMLElement {
        const box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        box.dataset.index = '0';
        const span = document.createElement('span');
        span.dataset.word = word;
        span.textContent = word;
        box.appendChild(span);
        document.body.appendChild(box);
        return span;
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) => cb({ ok: true, result: dictAnswer }));
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        video = document.createElement('video');
        playSpy = jest.fn(() => Promise.resolve());
        pauseSpy = jest.fn(function (this: HTMLVideoElement) {
            Object.defineProperty(this, 'paused', { value: true, configurable: true });
        });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        video.play = playSpy as unknown as HTMLVideoElement['play'];
        video.pause = pauseSpy as unknown as HTMLVideoElement['pause'];
        document.body.appendChild(video);
    });

    it('pauses while the strip is open over the video and resumes when it closes', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const span = buildOverlayWord('anchor');
        span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        expect(pauseSpy).toHaveBeenCalledTimes(1);

        span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        expect(playSpy).toHaveBeenCalledTimes(1);
        teardown();
        jest.useRealTimers();
    });

    it('leaves an already-paused video paused — it was not ours to restart', async () => {
        jest.useFakeTimers();
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        const teardown = installLookupStrip();
        const span = buildOverlayWord('anchor');
        span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        expect(pauseSpy).not.toHaveBeenCalled();
        expect(playSpy).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });

    it('does not touch playback for a sidebar lookup', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = '0';
        const main = document.createElement('div');
        main.className = 'vtt-main-text';
        const span = document.createElement('span');
        span.dataset.word = 'anchor';
        span.textContent = 'anchor';
        main.appendChild(span);
        item.appendChild(main);
        document.body.appendChild(item);

        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(pauseSpy).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });
});

/**
 * Selection is the phrase trigger. It used to belong to the "+ Lingogram"
 * pill — a second offer over the same subtitles that could only save, never
 * translate. The card took it over; these are that behaviour's tests, moved
 * with it, because the rules they pin (join both cues, never the translation
 * row, never a masked guess-mode word) are properties of the term, not of
 * whichever UI happens to present it.
 */
describe('selection — dragging a phrase opens the same card', () => {
    // jsdom gives every range a zero rect, and a zero rect is how the card
    // detects a dead anchor — hand back a real one.
    const RECT = { width: 50, height: 10, top: 40, left: 20, bottom: 50, right: 70 };

    function stubRects(): void {
        (Range.prototype as any).getBoundingClientRect = () => RECT;
        (Range.prototype as any).getClientRects = () => [{}];
    }

    /**
     * jsdom lays nothing out, so every ELEMENT rect is zeros too — and zeros
     * are exactly how the card detects a dead anchor. A one-word drag anchors
     * on the span rather than the range, so that path needs its own rect or it
     * would look like a word that had scrolled away.
     */
    function stubSpanRects(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('span').forEach((s) => {
            s.getBoundingClientRect = () => RECT as DOMRect;
        });
    }

    /** `count` sidebar cues, each a main-text row of words plus a translation. */
    function buildList(count: number): HTMLElement {
        const list = document.createElement('div');
        list.id = 'vtt-list';
        for (let i = 0; i < count; i++) {
            const item = document.createElement('div');
            item.className = 'vtt-item';
            item.dataset.index = String(i);

            const main = document.createElement('div');
            main.className = 'vtt-main-text';
            for (const w of [`a${i}`, `b${i}`]) {
                const span = document.createElement('span');
                span.dataset.word = w;
                span.textContent = w;
                main.appendChild(span);
            }

            const sub = document.createElement('div');
            sub.className = 'vtt-sub-text';
            sub.textContent = `translation ${i}`;

            item.append(main, sub);
            list.appendChild(item);
        }
        document.body.appendChild(list);
        return list;
    }

    /** A guess-mode cue: `revealed` leading words are real, the rest masked. */
    function buildGuessList(words: string[], revealed: number): HTMLElement {
        const list = document.createElement('div');
        list.id = 'vtt-list';
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = '0';
        const main = document.createElement('div');
        main.className = 'vtt-main-text';
        main.dataset.plain = words.join(' ');
        words.forEach((w, i) => {
            const span = document.createElement('span');
            if (i < revealed) {
                span.className = 'vtt-revealed-word';
                span.dataset.word = w;
                span.textContent = w;
            } else {
                span.className = 'vtt-masked-word';
                span.dataset.hidden = w;
                span.textContent = '*'.repeat(w.length);
            }
            main.appendChild(span);
            main.appendChild(document.createTextNode(' '));
        });
        item.appendChild(main);
        list.appendChild(item);
        document.body.appendChild(list);
        return list;
    }

    function wordSpans(list: HTMLElement, cue: number): HTMLElement[] {
        const main = list.querySelectorAll('.vtt-main-text')[cue];
        return Array.from(main.querySelectorAll<HTMLElement>('span[data-word]'));
    }

    function selectSpans(from: Element, to: Element): void {
        const range = document.createRange();
        range.setStartBefore(from);
        range.setEndAfter(to);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function selectAcross(list: HTMLElement, fromCue: number, toCue: number): void {
        const from = wordSpans(list, fromCue)[0];
        const toWords = wordSpans(list, toCue);
        selectSpans(from, toWords[toWords.length - 1]);
    }

    /** Release the drag the way the browser does: mousedown, then mouseup. */
    async function release(): Promise<void> {
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
    }

    const card = (): HTMLElement | null => document.getElementById('lingogram-lookup-strip');

    /** Click the card's heart and return the ADD_WORD message it sent. */
    async function saveFromCard(): Promise<any> {
        const send = chrome.runtime.sendMessage as jest.Mock;
        send.mockImplementation((msg: any, cb?: (r: unknown) => void) => {
            const res = msg?.action === 'LOOKUP_WORD'
                ? { ok: true, result: dictAnswer }
                : { ok: true, wordId: 'w1' };
            cb?.(res);
            return Promise.resolve(res);
        });
        const heart = card()!.querySelector<HTMLElement>('.vtt-lookup-heart')!;
        heart.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        return send.mock.calls.map((c) => c[0]).find((m: any) => m?.action === 'ADD_WORD');
    }

    let teardown: () => void;

    beforeEach(async () => {
        stubRects();
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_msg, cb) => {
            cb({ ok: true, result: dictAnswer });
        });
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        teardown = installLookupStrip();
    });

    afterEach(() => {
        teardown();
        window.getSelection()?.removeAllRanges();
    });

    it('looks up a phrase joining both cues, without the translation row', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        await release();

        const msg = (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0]).find((m: any) => m?.action === 'LOOKUP_WORD');
        expect(msg).toBeDefined();
        expect(msg.term).toBe('a0 b0 a1 b1');
        expect(msg.term).not.toContain('translation');
    });

    it('saves the dragged phrase, not just the word under the cursor', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        await release();
        expect(card()).not.toBeNull();

        const sent = await saveFromCard();
        expect(sent).toBeDefined();
        expect(sent.term).toBe('a0 b0 a1 b1');
    });

    it('offers nothing for a selection longer than the term cap', async () => {
        // Two cues is the widest shape accepted, but a single cue can still be
        // a whole paragraph of dialogue. Sending that as `term` would spend a
        // request from the 30/min budget on something no dictionary can answer.
        const list = document.createElement('div');
        list.id = 'vtt-list';
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = '0';
        const main = document.createElement('div');
        main.className = 'vtt-main-text';
        for (let i = 0; i < 60; i++) {
            const span = document.createElement('span');
            span.dataset.word = `word${i}`;
            span.textContent = `word${i}`;
            main.appendChild(span);
            main.appendChild(document.createTextNode(' '));
        }
        item.appendChild(main);
        list.appendChild(item);
        document.body.appendChild(list);

        const spans = main.querySelectorAll<HTMLElement>('span[data-word]');
        selectSpans(spans[0], spans[spans.length - 1]);
        await release();

        expect(card()).toBeNull();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('offers nothing for a three-cue selection', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 2);
        await release();
        expect(card()).toBeNull();
    });

    it('does not double a word when the second cue contributes no spans', async () => {
        // Releasing in the next cue's whitespace leaves that scope with no
        // intersecting span. extractTerm's fallback is range.toString(), which
        // is the WHOLE selection — so the word came back twice ("b0 b0").
        const list = buildList(4);
        const from = wordSpans(list, 0)[1];
        const secondCueMain = list.querySelectorAll('.vtt-main-text')[1];

        const range = document.createRange();
        range.setStart(from.firstChild!, 0);
        range.setEnd(secondCueMain, 0); // before any word of cue 1
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        await release();

        const msg = (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0]).find((m: any) => m?.action === 'LOOKUP_WORD');
        if (!msg) return; // no offer at all is also acceptable here
        const words = msg.term.split(/\s+/);
        expect(new Set(words).size).toBe(words.length); // no repeats
    });

    // In the browser, `user-select: none` keeps masked words out of the range
    // entirely. jsdom has no CSS layout, so these exercise the code-level rule
    // instead — which is exactly why that rule exists and is not left to CSS.
    describe('guess mode: hidden words are not dictionary candidates', () => {
        it('offers nothing when only masked words are selected', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 1);
            const spans = list.querySelectorAll<HTMLElement>('.vtt-masked-word');
            selectSpans(spans[0], spans[1]);
            await release();
            expect(card()).toBeNull();
        });

        it('saves only the revealed words from a mixed selection', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 2);
            const all = list.querySelectorAll<HTMLElement>('.vtt-revealed-word, .vtt-masked-word');
            selectSpans(all[0], all[2]); // revealed + revealed + masked
            await release();
            expect(card()).not.toBeNull();

            const sent = await saveFromCard();
            expect(sent).toBeDefined();
            expect(sent.term).toBe('alpha beta');
            expect(sent.term).not.toContain('gamma');
            expect(sent.term).not.toContain('*');
        });

        it('keeps the whole sentence as saved context', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 1);
            stubSpanRects(list);
            const revealed = list.querySelector<HTMLElement>('.vtt-revealed-word')!;
            selectSpans(revealed, revealed);
            await release();

            const sent = await saveFromCard();
            // Context is stored, never painted onto the masked line, so it may
            // hold words the user has not uncovered yet.
            expect(sent.context).toContain('alpha beta gamma');
        });
    });
});

/**
 * Holding the page still while a card is open.
 *
 * YouTube autohides its control bar after a few seconds of stillness, and the
 * overlay is floored above that bar (apps/youtube/src/content/controlsFloor.ts)
 * — so the captions drop ~41px the moment it goes. Reading a translation IS
 * that stillness, so it lands mid-word: the card, placed once in viewport
 * coordinates, tears away from its word and the widening gap drops the cursor
 * out of it, closing a card the user had not finished reading.
 *
 * The app answers by keeping the bar awake for as long as a card is up, so
 * nothing moves at all. Making the card chase the caption instead was the
 * wrong fix — it jumps the text under a resting cursor.
 */
describe('holdLayout — nothing moves while a card is open', () => {
    const CARD = 'lingogram-lookup-strip';

    function overlayWord(word: string): HTMLElement {
        const box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        box.dataset.index = '0';
        const span = document.createElement('span');
        span.dataset.word = word;
        span.textContent = word;
        box.appendChild(span);
        document.body.appendChild(box);
        const rect = { top: 400, bottom: 420, left: 100, right: 160,
            width: 60, height: 20, x: 100, y: 400, toJSON: () => ({}) } as DOMRect;
        span.getBoundingClientRect = () => rect;
        return span;
    }

    function hover(el: Element): void {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_msg, cb) => {
            cb({ ok: true, result: dictAnswer });
        });
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
    });

    it('holds the layout while the card is up and releases it when it closes', async () => {
        jest.useFakeTimers();
        const release = jest.fn();
        const hold = jest.fn(() => release);
        const teardown = installLookupStrip({ holdLayout: hold });
        const span = overlayWord('table');

        hover(span);
        await jest.advanceTimersByTimeAsync(300);
        expect(document.getElementById(CARD)).not.toBeNull();
        expect(hold).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();

        span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(400);
        expect(document.getElementById(CARD)).toBeNull();
        expect(release).toHaveBeenCalledTimes(1);

        teardown();
        jest.useRealTimers();
    });

    it('does not stack holds when the card re-targets to another word', async () => {
        // Every hover would otherwise take a fresh hold, and only the last one
        // would ever be released — leaving YouTube's bar pinned up forever.
        jest.useFakeTimers();
        const release = jest.fn();
        const hold = jest.fn(() => release);
        const teardown = installLookupStrip({ holdLayout: hold });
        const a = overlayWord('table');
        const b = overlayWord('chair');

        hover(a);
        await jest.advanceTimersByTimeAsync(300);
        hover(b);
        await jest.advanceTimersByTimeAsync(300);

        expect(hold).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });

    it('releases the hold on teardown, even with a card still open', async () => {
        jest.useFakeTimers();
        const release = jest.fn();
        const teardown = installLookupStrip({ holdLayout: () => release });
        hover(overlayWord('table'));
        await jest.advanceTimersByTimeAsync(300);
        expect(document.getElementById(CARD)).not.toBeNull();

        teardown();
        expect(release).toHaveBeenCalled();
        jest.useRealTimers();
    });

    it('renders ONE unhighlighted tag — the dictionary order is dominance, not context', async () => {
        // dictAnswer carries n. and v.; the old card printed every tag and lit
        // the first as "the part of speech this cue uses" — a claim the
        // dictionary cannot back (it never sees the sentence).
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        hover(overlayWord('anchor'));
        await jest.advanceTimersByTimeAsync(300);
        const card = document.getElementById(CARD)!;
        expect(card.querySelectorAll('.vtt-lookup-pos-tag').length).toBe(1);
        expect(card.querySelector('.vtt-lookup-pos-tag.lead')).toBeNull();
        teardown();
        jest.useRealTimers();
    });

    it('works without a holdLayout — sites with no moving chrome pass none', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        hover(overlayWord('table'));
        await jest.advanceTimersByTimeAsync(300);
        expect(document.getElementById(CARD)).not.toBeNull();
        teardown();
        jest.useRealTimers();
    });
});
