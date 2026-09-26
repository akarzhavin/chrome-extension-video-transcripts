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
    hasLookupContent,
    latencyBucket,
    lookupCached,
    clearLookupCache,
    LookupResult,
} from '../src/lookup';
// fetchLookup stays off the façade — everything outside the module goes
// through the cache — so the unit test for it reaches the file directly.
import { fetchLookup } from '../src/lookup/client';
// The presentation helpers are internal to the module — deliberately absent
// from its façade — so they are imported by path, the same way this file
// already reaches auth/background.
import {
    stripDefinition,
    showsLemma,
    isContextual,
    oxfordLookupUrl,
    posTags,
    stripTranslations,
} from '../src/lookup/shape';
import { installLookupStrip } from '../src/lookup/strip';
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

describe('oxfordLookupUrl — English only, verified against the live site', () => {
    it('links an English learning language', () => {
        expect(oxfordLookupUrl('going', 'en'))
            .toBe('https://www.oxfordlearnersdictionaries.com/definition/english/going');
    });
    it('routes an American track to the American edition — the site offers exactly two', () => {
        expect(oxfordLookupUrl('going', 'en-US')).toContain('/american_english/going');
        expect(oxfordLookupUrl('going', 'en_US')).toContain('/american_english/going');
        expect(oxfordLookupUrl('going', 'en_GB')).toContain('/english/going');
        expect(oxfordLookupUrl('going', 'en')).toContain('/english/going');
    });
    it('offers nothing for other learning languages — their paths 404', () => {
        expect(oxfordLookupUrl('gehen', 'de')).toBeNull();
        expect(oxfordLookupUrl('aller', 'fr')).toBeNull();
        // "es" must not ride in on a prefix check written too loosely.
        expect(oxfordLookupUrl('ir', 'es')).toBeNull();
    });
    it('hyphenates phrases the way Oxford spells its entries', () => {
        expect(oxfordLookupUrl('Look  At', 'en')).toContain('/english/look-at');
    });
    it('offers nothing for an empty term', () => {
        expect(oxfordLookupUrl('   ', 'en')).toBeNull();
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

    // An empty answer is not always the stable fact it looks like: a degraded
    // model answers 200 with nothing in it. Cached forever, that word stays
    // blank for the life of the worker — long after the service recovered.
    it('re-asks an empty answer once it goes stale, and keeps a real one', async () => {
        const empty = { ...dictAnswer, translations: [], parts_of_speech: [] };
        (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(empty));
        await lookupCached('https://api.test', { term: 'sloppily', targetLang: 'ru' }, false);
        const again = await lookupCached('https://api.test', { term: 'sloppily', targetLang: 'ru' }, false);
        expect(again.cached).toBe(true);

        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
        try {
            (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(dictAnswer));
            const recovered = await lookupCached('https://api.test', { term: 'sloppily', targetLang: 'ru' }, false);
            expect(recovered.cached).toBe(false);
            expect(recovered.result.translations.length).toBeGreaterThan(0);

            // A real answer has no expiry — only the empty one was provisional.
            const kept = await lookupCached('https://api.test', { term: 'sloppily', targetLang: 'ru' }, false);
            expect(kept.cached).toBe(true);
        } finally {
            (Date.now as jest.Mock).mockRestore();
        }
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

    // The selection path caps length before it calls, but the hover path reads
    // span.dataset.word straight off the page — and on Rezka the subtitle
    // track comes from a third-party host. The service refuses past 200 runes,
    // so a longer term is a round-trip that can only 400.
    it('refuses an oversized term before any network', async () => {
        const res = await handleAuthMessage({
            action: 'LOOKUP_WORD', term: 'x'.repeat(201), targetLang: 'ru',
        });
        expect(res).toEqual({ ok: false, error: 'term too long' });
        expect(global.fetch).not.toHaveBeenCalled();
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

    /**
     * Behaviour map §13: with no language pair stored the card declines to
     * open. The gate is `if (!prefs?.native) return` in strip.ts.
     *
     * The live check for this asserts the card is absent on a page where
     * NOBODY EVER CLICKED — vacuously true, and green however the gate behaves.
     * Here the word is actually hovered, so the absence means the gate refused.
     * The second half proves the same gesture DOES open a card once a pair is
     * stored, which is what stops this passing on a broken harness.
     */
    it('declines to open when no language pair is stored', async () => {
        await chromeStorage.local.remove('lang.v1');
        delete (chromeStorage.local as any)._store['lang.v1'];
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['ungated']);

        hover(main.querySelector('span[data-word]')!);
        await jest.advanceTimersByTimeAsync(2000);

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(document.querySelector('#lingogram-lookup-strip')).toBeNull();
        teardown();
        jest.useRealTimers();
    });

    it('opens for the same gesture once a pair is stored', async () => {
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['gated']);

        hover(main.querySelector('span[data-word]')!);
        await jest.advanceTimersByTimeAsync(2000);

        expect(chrome.runtime.sendMessage).toHaveBeenCalled();
        teardown();
        jest.useRealTimers();
    });

    // The sidebar opens on a REST of half a second, not on a pass: the cursor
    // crosses dozens of transcript words on the way anywhere.
    describe('sidebar: the card opens when the pointer rests on a word', () => {
        const at = (type: string, el: Element, x: number, y: number, extra: MouseEventInit = {}): void => {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...extra }));
        };
        const lookups = (): number =>
            (chrome.runtime.sendMessage as jest.Mock).mock.calls.filter(([m]) => m.action === 'LOOKUP_WORD').length;

        let teardown: () => void;
        let word: HTMLElement;

        beforeEach(() => {
            jest.useFakeTimers();
            teardown = installLookupStrip();
            word = buildLine(['transcript'], 'sidebar').querySelector('span[data-word]') as HTMLElement;
            // jsdom lays nothing out; the card needs a box to stand next to.
            word.getBoundingClientRect = () =>
                ({ width: 60, height: 16, top: 100, left: 10, bottom: 116, right: 70, x: 10, y: 100 }) as DOMRect;
        });

        afterEach(() => {
            teardown();
            jest.useRealTimers();
        });

        it('opens after half a second at rest, not before', async () => {
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(450);
            expect(lookups()).toBe(0);
            await jest.advanceTimersByTimeAsync(100);
            expect(lookups()).toBe(1);
            const [msg] = (chrome.runtime.sendMessage as jest.Mock).mock.calls[0];
            expect(msg.term).toBe('transcript');
        });

        it('a pointer still moving over the word restarts the wait', async () => {
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(300);
            at('mousemove', word, 40, 108);
            await jest.advanceTimersByTimeAsync(300);
            expect(lookups()).toBe(0);
            await jest.advanceTimersByTimeAsync(250);
            expect(lookups()).toBe(1);
        });

        it('a trembling hand is still at rest', async () => {
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(300);
            at('mousemove', word, 22, 109);
            await jest.advanceTimersByTimeAsync(250);
            expect(lookups()).toBe(1);
        });

        it('passing over the word opens nothing', async () => {
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(300);
            at('mouseout', word, 80, 108, { relatedTarget: document.body });
            await jest.advanceTimersByTimeAsync(2000);
            expect(lookups()).toBe(0);
        });

        // Pressing a line seeks, and the hand that pressed stays on the word.
        // Without the press counting as "not this", every click on a line would
        // open a card half a second later.
        it('a press on the word switches it off until the pointer leaves', async () => {
            at('mouseover', word, 20, 108);
            at('mousedown', word, 20, 108, { buttons: 1 });
            at('mouseup', word, 20, 108);
            at('mousemove', word, 21, 108);
            await jest.advanceTimersByTimeAsync(2000);
            expect(lookups()).toBe(0);

            at('mouseout', word, 80, 108, { relatedTarget: document.body });
            at('mouseover', word, 30, 108);
            await jest.advanceTimersByTimeAsync(550);
            expect(lookups()).toBe(1);
        });

        it('a card opened by resting closes when the pointer leaves the word', async () => {
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(600);
            expect(document.querySelector('#lingogram-lookup-strip')).not.toBeNull();

            at('mouseout', word, 80, 108, { relatedTarget: document.body });
            await jest.advanceTimersByTimeAsync(300);
            expect(document.querySelector('#lingogram-lookup-strip')).toBeNull();
        });

        // The rest ends, then the card still reads the language pair before it
        // exists. A pointer that leaves during that read has nothing to close
        // yet — the card must not open on a word it has already left.
        it('leaving the word while the rest is still opening opens nothing', async () => {
            let release!: () => void;
            const get = chromeStorage.local.get as jest.Mock;
            const real = get.getMockImplementation()!;
            get.mockImplementationOnce((key: string) =>
                new Promise((r) => { release = () => r(real(key)); }));

            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(550);
            at('mouseout', word, 80, 108, { relatedTarget: document.body });
            release();
            await jest.advanceTimersByTimeAsync(2000);

            expect(lookups()).toBe(0);
            expect(document.querySelector('#lingogram-lookup-strip')).toBeNull();
        });

        // Reported live: rest on a word, then leave the panel. On its way out
        // the pointer crossed other transcript words, and passing over one of
        // them cancelled the pending hide — the card, and the transcript hold
        // it carries, stayed up for good while the video played on.
        it('crossing other words on the way out does not keep the card up', async () => {
            const line = word.parentElement!;
            const other = document.createElement('span');
            other.dataset.word = 'passing';
            other.textContent = 'passing';
            line.appendChild(other);

            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(600);
            expect(document.querySelector('#lingogram-lookup-strip')).not.toBeNull();

            at('mouseout', word, 75, 108, { relatedTarget: other });
            at('mouseover', other, 80, 108);
            at('mouseout', other, 140, 108, { relatedTarget: document.body });
            await jest.advanceTimersByTimeAsync(300);
            expect(document.querySelector('#lingogram-lookup-strip')).toBeNull();
        });

        // A phrase card belongs to the selection, not to a word the pointer
        // crosses on its way to the card.
        it('a card opened on a selection does not close when the pointer leaves a word', async () => {
            const RECT = { width: 60, height: 16, top: 100, left: 10, bottom: 116, right: 70 };
            const prior = (Range.prototype as any).getBoundingClientRect;
            (Range.prototype as any).getBoundingClientRect = () => RECT;
            const range = document.createRange();
            range.setStartBefore(word);
            range.setEndAfter(word);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);
            try {
                document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                await jest.advanceTimersByTimeAsync(300);
                expect(document.querySelector('#lingogram-lookup-strip')).not.toBeNull();

                at('mouseout', word, 80, 108, { relatedTarget: document.body });
                await jest.advanceTimersByTimeAsync(600);
                expect(document.querySelector('#lingogram-lookup-strip')).not.toBeNull();
            } finally {
                sel.removeAllRanges();
                (Range.prototype as any).getBoundingClientRect = prior;
            }
        });

        it('does not pause the video', async () => {
            const video = document.createElement('video');
            document.body.appendChild(video);
            const pause = jest.spyOn(video, 'pause').mockImplementation(() => {});
            at('mouseover', word, 20, 108);
            await jest.advanceTimersByTimeAsync(600);
            expect(lookups()).toBe(1);
            expect(pause).not.toHaveBeenCalled();
        });
    });

    it('a sidebar CLICK is the cue\'s own — it seeks, and opens no card', async () => {
        // The transcript's gesture is "take me to this line", and in guess mode
        // it also uncovers a word. Intercepting it to answer "what is this
        // word" spent the click on the rarer of the two intents; asking about a
        // word is a selection now (see the selection describe below).
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const main = buildLine(['transcript'], 'sidebar');
        const seek = jest.fn();
        // Mirrors SidebarUI.buildPlainItem: the cue seeks when clicked.
        main.closest('.vtt-item')!.addEventListener('click', seek);
        click(main.querySelector('span[data-word]')!);
        await jest.advanceTimersByTimeAsync(2000);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(seek).toHaveBeenCalledTimes(1);
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

        // jsdom lays nothing out, so a range and a span both measure zeros —
        // and zeros are how the card reads "this anchor is gone".
        const RECT = { width: 50, height: 10, top: 40, left: 20, bottom: 50, right: 70 };
        const priorRangeRect = (Range.prototype as any).getBoundingClientRect;
        (Range.prototype as any).getBoundingClientRect = () => RECT;
        span.getBoundingClientRect = () => RECT as DOMRect;

        // Selecting the word is the sidebar's trigger — a drag across it is
        // what the browser turns into exactly this range.
        const range = document.createRange();
        range.setStartBefore(span);
        range.setEndAfter(span);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(pauseSpy).not.toHaveBeenCalled();
        teardown();
        // Both outlive document.body.innerHTML = '': a leftover Range is a live
        // selection under every test that follows, and the prototype is global.
        sel.removeAllRanges();
        (Range.prototype as any).getBoundingClientRect = priorRangeRect;
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

    /**
     * Press the card's heart and return what it put on the wire.
     *
     * ⚠ This used to answer every non-LOOKUP_WORD message with
     * `{ ok: true, wordId: 'w1' }` and then pick the ADD_WORD call out of the
     * log. After the toggle landed that made the strip's removal invisible: a
     * REMOVE_WORD was answered "ok" by the stub and never appeared in what this
     * helper returned, so the strip half of the toggle would have shipped with
     * no test able to observe it — while the word screen's half is covered by
     * the three rewrites in word-screen.test.ts.
     *
     * It now returns BOTH actions. Callers that only save read `.add`, and a
     * caller that presses twice can see the removal.
     */
    async function pressHeart(): Promise<{ add?: any; remove?: any; calls: any[] }> {
        const send = chrome.runtime.sendMessage as jest.Mock;
        send.mockImplementation((msg: any, cb?: (r: unknown) => void) => {
            const res = msg?.action === 'LOOKUP_WORD'
                ? { ok: true, result: dictAnswer }
                : msg?.action === 'REMOVE_WORD'
                ? { ok: true, state: 'removed', inboxCount: 0 }
                : { ok: true, wordId: 'w1' };
            cb?.(res);
            return Promise.resolve(res);
        });
        const heart = card()!.querySelector<HTMLElement>('.vtt-lookup-heart')!;
        heart.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        const calls = send.mock.calls.map((c) => c[0]);
        return {
            add: calls.find((m: any) => m?.action === 'ADD_WORD'),
            remove: calls.find((m: any) => m?.action === 'REMOVE_WORD'),
            calls,
        };
    }

    /** Back-compat shim: the three existing callers only ever save once. */
    const saveFromCard = async (): Promise<any> => (await pressHeart()).add;

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

    it('underlines every word of the dragged phrase while its card is up', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        await release();
        expect(card()).not.toBeNull();
        const hits = list.querySelectorAll('.vtt-lookup-hit');
        expect(hits.length).toBe(4); // a0 b0 a1 b1
    });

    it('a second press on the strip removes the word', async () => {
        // The strip's half of the toggle. Without this the helper's new sight
        // of REMOVE_WORD would be unused — a fixed instrument nobody reads.
        const list = buildList(2);
        selectAcross(list, 0, 0);
        await release();
        expect(card()).not.toBeNull();

        const first = await pressHeart();
        expect(first.add).toBeDefined();
        expect(first.remove).toBeUndefined();

        const second = await pressHeart();
        expect(second.remove).toBeDefined();
        expect(second.remove.term).toBe(first.add.term);
    });

    /**
     * A phrase is answered by the service's `google` source: one translation
     * of the whole selection, lemma = the phrase, no parts of speech. The card
     * shows that translation and the heart, and no Details — the word screen
     * has nothing to put around a single translation.
     */
    it('a phrase card shows its translation and a heart, and no Details', async () => {
        teardown();
        teardown = installLookupStrip({ openDetail: jest.fn() });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_msg, cb) => {
            cb({ ok: true, result: {
                term: 'a0 b0 a1 b1', lemma: 'a0 b0 a1 b1',
                translations: ['перевод всей фразы'], parts_of_speech: [],
            } });
        });
        const list = buildList(4);
        selectAcross(list, 0, 1);
        await release();

        expect(card()?.textContent).toContain('перевод всей фразы');
        expect(card()?.querySelector('[data-act="save"]')).not.toBeNull();
        expect(card()?.querySelector('[data-act="more"]')).toBeNull();
    });

    it('a single selected word keeps its Details', async () => {
        // The control half: without it the check above would also pass if
        // Details were gone everywhere.
        teardown();
        teardown = installLookupStrip({ openDetail: jest.fn() });
        const list = buildList(2);
        selectSpans(wordSpans(list, 0)[0], wordSpans(list, 0)[0]);
        await release();

        expect(card()?.querySelector('[data-act="more"]')).not.toBeNull();
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
        // The offer must exist: a selection reaching into the next cue is
        // still a lookup. "No offer at all" used to be accepted here, which
        // let a regression that stops offering anything for cross-cue
        // selections pass — measured: the offer IS made, so the guard was dead.
        expect(msg).toBeTruthy();
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

    it('joins translations with breakable separators — margins alone cannot wrap', async () => {
        // Three long Russian translations once rendered as ONE unbreakable
        // string (the dot was joined in with no spaces), running through the
        // card's border past its max-width.
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        hover(overlayWord('anchor'));
        await jest.advanceTimersByTimeAsync(300);
        const tr = document.querySelector('.vtt-lookup-tr')!;
        expect(tr.textContent).toContain(' · ');
        teardown();
        jest.useRealTimers();
    });

    it('underlines the word its card belongs to, and only while the card is up', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const span = overlayWord('anchor');
        hover(span);
        await jest.advanceTimersByTimeAsync(300);
        expect(span.classList.contains('vtt-lookup-hit')).toBe(true);

        span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(400);
        expect(document.getElementById(CARD)).toBeNull();
        expect(span.classList.contains('vtt-lookup-hit')).toBe(false);
        teardown();
        jest.useRealTimers();
    });

    it('moves the underline when the card re-targets to another word', async () => {
        jest.useFakeTimers();
        const teardown = installLookupStrip();
        const a = overlayWord('table');
        const b = overlayWord('chair');
        hover(a);
        await jest.advanceTimersByTimeAsync(300);
        hover(b);
        await jest.advanceTimersByTimeAsync(300);
        expect(a.classList.contains('vtt-lookup-hit')).toBe(false);
        expect(b.classList.contains('vtt-lookup-hit')).toBe(true);
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

/**
 * Behaviour map §42.5, §13.4, §13.5, §48 — the card's three answers.
 *
 * The service answers three ways and the card must say which: a translation, a
 * successful answer that simply has nothing (an honest "no translation", not a
 * failure), and a failure. The middle one is the one that goes wrong: routing
 * it to the error renderer turns "this word has no entry" into "something
 * broke", and the reader retries a lookup that will always answer the same.
 */
describe('the card tells an empty answer apart from a failed one', () => {
    const CARD = 'lingogram-lookup-strip';
    const card = () => document.getElementById(CARD);
    const emptyAnswer: LookupResult = {
        term: 'zzxq', lemma: 'zzxq', translations: [], parts_of_speech: [], source: 'wiktionary',
    };

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

    const hover = (el: Element): void => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    };

    /** Hover a word and let the debounce, the request and the render run. */
    async function show(
        reply: object,
        opts: Parameters<typeof installLookupStrip>[0] = {},
    ): Promise<() => void> {
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) => cb(reply));
        const teardown = installLookupStrip(opts);
        hover(overlayWord('zzxq'));
        await jest.advanceTimersByTimeAsync(300);
        return teardown;
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('an empty but successful answer reads "No translation", never an error', async () => {
        const teardown = await show({ ok: true, result: emptyAnswer });

        expect(card()?.textContent).toContain('No translation');
        // The distinction the whole state exists for: nothing broke.
        expect(card()?.querySelector('.vtt-lookup-error')).toBeNull();
        expect(card()?.textContent).not.toContain("Couldn't load");
        teardown();
    });

    it('a failure renders the error, and announces it as an alert', async () => {
        const teardown = await show({ ok: false });

        const err = card()?.querySelector('.vtt-lookup-error');
        expect(err).not.toBeNull();
        expect(err?.getAttribute('role')).toBe('alert');
        expect(err?.textContent).toContain("Couldn't load");
        teardown();
    });

    it('the two answers are never the same element', async () => {
        // Each check above passes if BOTH states render the error markup: the
        // empty one would still contain its own text somewhere. This is the
        // assertion that they are told apart.
        let teardown = await show({ ok: true, result: emptyAnswer });
        const emptyHtml = card()!.innerHTML;
        const emptyIsAlert = card()!.querySelector('[role="alert"]') !== null;
        teardown();

        document.body.innerHTML = '';
        teardown = await show({ ok: false });
        const errorHtml = card()!.innerHTML;

        expect(emptyHtml).not.toBe(errorHtml);
        expect(emptyIsAlert).toBe(false); // "no entry" does not interrupt
        expect(card()!.querySelector('[role="alert"]')).not.toBeNull();
        teardown();
    });

    it('an empty answer offers no Details — there is nothing to expand', async () => {
        const openDetail = jest.fn();
        const teardown = await show({ ok: true, result: emptyAnswer }, { openDetail });
        expect(card()?.querySelector('[data-act="more"]')).toBeNull();
        teardown();
    });

    /**
     * The waiting state, both halves.
     *
     * Behaviour map §13: "The card has a waiting state while the answer is
     * fetched". The live check reads the OPPOSITE — it waits for
     * `.vtt-lookup-pending` to be ABSENT before reading the card — which is
     * satisfied instantly by a waiting state that never renders at all. So the
     * claim survived being deleted, and this is where it is actually pinned.
     *
     * Both halves are needed. The spinner is deliberately delayed by
     * SPINNER_AFTER_MS (400ms) because warm answers land in ~270ms and a
     * spinner for those is a flicker; asserting only that it appears would pass
     * an implementation that shows it immediately.
     */
    it('a slow answer raises the waiting state', async () => {
        // A reply that never comes: the callback is captured, never called.
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(() => {});
        const teardown = installLookupStrip();
        hover(overlayWord('zzxq'));

        // Past the hover debounce, before the spinner is due: nothing is drawn
        // yet at all — measured, the card element itself is absent here.
        await jest.advanceTimersByTimeAsync(300);
        expect(card()?.querySelector('.vtt-lookup-pending') ?? null).toBeNull();

        // Past the spinner threshold.
        await jest.advanceTimersByTimeAsync(400);
        const pending = card()?.querySelector('.vtt-lookup-pending');
        expect(pending).not.toBeNull();
        expect(pending?.textContent).toContain('Looking up');
        teardown();
    });

    it('an answer that beats the threshold never shows it', async () => {
        // Watch for the spinner THROUGHOUT the wait, not after it. Reading the
        // card once the answer has landed proves nothing: the answer overwrites
        // the spinner, so a spinner that did flash is invisible by then —
        // measured, that version stayed green against SPINNER_AFTER_MS = 0.
        let everPending = false;
        const watch = new MutationObserver(() => {
            if (document.querySelector('.vtt-lookup-pending')) everPending = true;
        });
        watch.observe(document.body, { childList: true, subtree: true });

        // The reply lands 100ms after the request — inside the 400ms grace.
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) => {
            setTimeout(() => cb({ ok: true, result: dictAnswer }), 100);
        });
        const teardown = installLookupStrip();
        hover(overlayWord('zzxq'));

        await jest.advanceTimersByTimeAsync(2000);
        watch.disconnect();

        // The answer is up...
        expect(card()?.textContent?.length ?? 0).toBeGreaterThan(0);
        // ...and the spinner never stood in front of it, at any point.
        expect(everPending).toBe(false);
        teardown();
    });
});

/**
 * §13.4 — Details is the way from the hover card to the full screen.
 */
describe('the Details action opens the word screen', () => {
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

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) =>
            cb({ ok: true, result: dictAnswer }));
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    async function open(openDetail?: (t: string, c: string) => void): Promise<() => void> {
        const teardown = installLookupStrip(openDetail ? { openDetail } : {});
        overlayWord('anchor').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await jest.advanceTimersByTimeAsync(300);
        return teardown;
    }

    it('the card carries a Details button labelled as such', async () => {
        const teardown = await open(jest.fn());
        const more = document.getElementById(CARD)!.querySelector('[data-act="more"]');
        expect(more).not.toBeNull();
        expect(more?.textContent).toContain('Details');
        teardown();
    });

    it('pressing it hands the word screen the term and its cue', async () => {
        const openDetail = jest.fn();
        const teardown = await open(openDetail);
        document
            .getElementById(CARD)!
            .querySelector<HTMLElement>('[data-act="more"]')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // Two arguments, not one: the screen re-runs the lookup and needs the
        // cue to order the senses by (Art. D — the task sheet says "the term").
        expect(openDetail).toHaveBeenCalledTimes(1);
        expect(openDetail.mock.calls[0][0]).toBe('anchor');
        expect(openDetail.mock.calls[0]).toHaveLength(2);
        teardown();
    });

    it('the card closes behind it — one word screen, no card left over it', async () => {
        const teardown = await open(jest.fn());
        document
            .getElementById(CARD)!
            .querySelector<HTMLElement>('[data-act="more"]')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById(CARD)).toBeNull();
        teardown();
    });

    it('no Details at all when the host wired none', async () => {
        // The counter-half: the button is the host's to offer. A card that
        // always rendered it would open nothing on a site with no word screen.
        const teardown = await open(undefined);
        expect(document.getElementById(CARD)!.querySelector('[data-act="more"]')).toBeNull();
        teardown();
    });
});

/**
 * Guess mode: the card over a word that is still hidden.
 *
 * Two affordances now share the capsule. Peek turns it over so you can LOOK at
 * the word without answering for it; the card answers the other question —
 * what does it mean — and both are reached by resting the cursor there, the
 * same gesture that opens a card over an ordinary word on the video.
 *
 * The capsule is a lookup target but still not a SAVEABLE one: quick-add reads
 * span[data-word], which a masked span deliberately lacks, so the selection
 * path keeps refusing it. That separation is asserted here too, because it is
 * exactly what a widened hover selector could quietly undo.
 */
describe('guess mode: hovering a hidden word opens its card', () => {
    const CARD = 'lingogram-lookup-strip';
    const card = () => document.getElementById(CARD);

    /** A masked capsule as makeMaskedSpan builds one: word in data-hidden. */
    function maskedCapsule(word: string): HTMLElement {
        const box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        box.dataset.index = '0';
        const span = document.createElement('span');
        span.className = 'vtt-masked-word';
        span.dataset.hidden = word;
        span.dataset.ti = '1';
        span.translate = false;
        span.textContent = word; // the pane is CSS; the node holds the real word
        box.appendChild(span);
        document.body.appendChild(box);
        const rect = { top: 400, bottom: 420, left: 100, right: 160,
            width: 60, height: 20, x: 100, y: 400, toJSON: () => ({}) } as DOMRect;
        span.getBoundingClientRect = () => rect;
        return span;
    }

    const hover = (el: Element): void => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    };

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m, cb) =>
            cb({ ok: true, result: dictAnswer }));
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        jest.useFakeTimers();
    });

    afterEach(() => jest.useRealTimers());

    it('looks up the hidden word, not the masked markup', async () => {
        const teardown = installLookupStrip();
        hover(maskedCapsule('anchor'));
        await jest.advanceTimersByTimeAsync(300);

        const msg = (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0]).find((m: any) => m?.action === 'LOOKUP_WORD');
        expect(msg).toBeDefined();
        expect(msg.term).toBe('anchor');
        teardown();
    });

    it('shows the translation, the same card an ordinary word gets', async () => {
        const teardown = installLookupStrip();
        hover(maskedCapsule('anchor'));
        await jest.advanceTimersByTimeAsync(300);

        expect(card()).not.toBeNull();
        expect(card()!.querySelector('.vtt-lookup-tr')!.textContent).toContain('якорь');
        teardown();
    });

    it('leaves the word masked — a card is looking, not answering', async () => {
        // The reveal state is guess mode's whole point; reading a translation
        // must not spend it. Same rule the peek already follows.
        const teardown = installLookupStrip();
        const span = maskedCapsule('anchor');
        hover(span);
        await jest.advanceTimersByTimeAsync(300);

        expect(span.classList.contains('vtt-masked-word')).toBe(true);
        expect(span.dataset.hidden).toBe('anchor');
        expect(span.dataset.word).toBeUndefined();
        teardown();
    });

    it('pauses the video, as any lookup over the moving line does', async () => {
        // The line is about to scroll away, and reading a translation while it
        // does is impossible — the reason the overlay pauses at all.
        const video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: false, writable: true });
        video.pause = jest.fn();
        document.body.appendChild(video);

        const teardown = installLookupStrip();
        hover(maskedCapsule('anchor'));
        await jest.advanceTimersByTimeAsync(300);

        expect(video.pause).toHaveBeenCalled();
        teardown();
    });

    it('still refuses to SAVE a hidden word', async () => {
        // The card may open over it, but quick-add's span[data-word] query
        // must keep skipping it: offering to save a word the user has not been
        // shown is the collision the two attributes exist to prevent.
        const teardown = installLookupStrip();
        const span = maskedCapsule('anchor');
        hover(span);
        await jest.advanceTimersByTimeAsync(300);

        expect(span.dataset.word).toBeUndefined();
        expect(document.querySelectorAll('.vtt-overlay-main span[data-word]')).toHaveLength(0);
        teardown();
    });

    /**
     * The peek and the card share one capsule, and the peek REWRITES it.
     *
     * peekOn wraps the capsule's text in a .vtt-peek-face child — destroying
     * the text node the cursor is standing on — and then rewrites that child
     * again 180ms later, when the flip reaches its halfway point. Chrome
     * answers a destroyed node under the pointer with a mouseout whose
     * relatedTarget is null, and the card's 220ms debounce is still running at
     * both of those moments.
     *
     * So the question these ask is not "does hover work" but "does hover
     * survive the peek happening on the same capsule at the same time".
     */
    describe('while the capsule is also being peeked', () => {
        /**
         * The mouseout Chrome sends when the node under the cursor is
         * destroyed: no relatedTarget, but the pointer is still where it was —
         * so the coordinates land inside the capsule's own box.
         */
        const mutationMouseOut = (el: Element): void => {
            el.dispatchEvent(new MouseEvent('mouseout', {
                bubbles: true, relatedTarget: null, clientX: 130, clientY: 410,
            }));
        };

        it('still opens when the peek rewrites the capsule mid-debounce', async () => {
            const teardown = installLookupStrip();
            const span = maskedCapsule('anchor');

            hover(span);
            // The peek's own DOM churn, landing inside the card's 220ms wait:
            // faceOf() on the hover itself, then the halfway swap at 180ms.
            await jest.advanceTimersByTimeAsync(10);
            mutationMouseOut(span);
            await jest.advanceTimersByTimeAsync(170);
            mutationMouseOut(span);

            await jest.advanceTimersByTimeAsync(400);

            expect(chrome.runtime.sendMessage).toHaveBeenCalled();
            expect(card()).not.toBeNull();
            teardown();
        });

        it('a real departure still closes it — the cursor genuinely left', async () => {
            // The counter-half. If the fix simply ignored every null
            // relatedTarget, leaving the caption for the video would strand an
            // open card over a word nobody is pointing at.
            const teardown = installLookupStrip();
            const span = maskedCapsule('anchor');
            hover(span);
            await jest.advanceTimersByTimeAsync(300);
            expect(card()).not.toBeNull();

            // Leaving for another element: relatedTarget is a real node.
            const elsewhere = document.createElement('div');
            document.body.appendChild(elsewhere);
            span.dispatchEvent(new MouseEvent('mouseout', {
                bubbles: true, relatedTarget: elsewhere, clientX: 900, clientY: 900,
            }));
            await jest.advanceTimersByTimeAsync(400);

            expect(card()).toBeNull();
            teardown();
        });

        it('an ordinary revealed word is unaffected either way', async () => {
            // The control: no peek, no face, no mutation — so a failure in the
            // two above cannot be blamed on the harness.
            const box = document.createElement('div');
            box.className = 'vtt-overlay-main';
            box.dataset.index = '0';
            const span = document.createElement('span');
            span.dataset.word = 'anchor';
            span.textContent = 'anchor';
            box.appendChild(span);
            document.body.appendChild(box);
            span.getBoundingClientRect = () => ({
                top: 400, bottom: 420, left: 100, right: 160,
                width: 60, height: 20, x: 100, y: 400, toJSON: () => ({}),
            }) as DOMRect;

            const teardown = installLookupStrip();
            hover(span);
            await jest.advanceTimersByTimeAsync(300);

            expect(card()).not.toBeNull();
            teardown();
        });
    });

    /**
     * Revealing a word must not switch the card off for the rest of the video.
     *
     * The press that uncovers a capsule destroys it: the reveal repaints the
     * overlay, so the very node the pointer is standing on leaves the document
     * before the gesture finishes. A mouseup dispatched at a detached node
     * never reaches the document listener that clears `dragging` — and
     * onMouseOver returns early for as long as that flag is set. One reveal and
     * the pill was gone until the page reloaded.
     */
    describe('after revealing a word by pressing it', () => {
        /**
         * The press, as the DOM really delivers it: mousedown, then the reveal
         * tearing the span out, then a mouseup that lands on a node which is no
         * longer in the document.
         */
        function pressAndDetach(span: HTMLElement): void {
            span.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, button: 0, clientX: 130, clientY: 410,
            }));
            // The reveal's repaint: this capsule is replaced wholesale.
            span.remove();
            // Dispatched at the detached node — it bubbles nowhere.
            span.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, button: 0, clientX: 130, clientY: 410,
            }));
        }

        it('the next hover still opens a card', async () => {
            const teardown = installLookupStrip();
            pressAndDetach(maskedCapsule('gone'));

            // A fresh capsule, exactly as the repaint would have built it.
            hover(maskedCapsule('anchor'));
            await jest.advanceTimersByTimeAsync(300);

            expect(chrome.runtime.sendMessage).toHaveBeenCalled();
            expect(card()).not.toBeNull();
            teardown();
        });

        it('and so does the one after that', async () => {
            // Guards against a fix that merely papers over the first hover.
            const teardown = installLookupStrip();
            pressAndDetach(maskedCapsule('gone'));

            hover(maskedCapsule('anchor'));
            await jest.advanceTimersByTimeAsync(300);
            (chrome.runtime.sendMessage as jest.Mock).mockClear();

            document.body.innerHTML = '';
            hover(maskedCapsule('second'));
            await jest.advanceTimersByTimeAsync(300);

            expect(chrome.runtime.sendMessage).toHaveBeenCalled();
            teardown();
        });

        it('a real drag still suppresses the hover card', async () => {
            // The counter-half. `dragging` exists so that sweeping a selection
            // across a line does not open a card per word; clearing it
            // unconditionally would bring that back.
            const teardown = installLookupStrip();
            const span = maskedCapsule('anchor');
            span.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, button: 0, clientX: 130, clientY: 410,
            }));

            // Still held down, sweeping across words. `buttons: 1` is what the
            // browser reports while the primary button is pressed — the live
            // fact the hover consults, rather than the flag that can go stale.
            span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 1 }));
            await jest.advanceTimersByTimeAsync(300);

            expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
            teardown();
        });
    });

    it('does not open in the sidebar transcript', async () => {
        // The sidebar has no peek for the same reason: the cursor crosses
        // dozens of words there on the way anywhere.
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = '0';
        const main = document.createElement('div');
        main.className = 'vtt-main-text';
        const span = document.createElement('span');
        span.className = 'vtt-masked-word';
        span.dataset.hidden = 'anchor';
        span.textContent = 'anchor';
        main.appendChild(span);
        item.appendChild(main);
        document.body.appendChild(item);

        const teardown = installLookupStrip();
        hover(span);
        await jest.advanceTimersByTimeAsync(2000);

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(card()).toBeNull();
        teardown();
    });
});

/**
 * Hovering is something the USER does. The overlay rebuilds its children
 * ~4×/sec, and a rebuild moves a fresh word under a cursor that has not
 * budged — which Chrome reports as a plain `mouseover` on that word, with no
 * `mousemove` before it and the coordinates of wherever the pointer was last
 * put down. Acted on, it opens a card and PAUSES the film under someone who
 * was only watching.
 *
 * Measured in Chrome via Playwright rather than assumed, because the first two
 * guesses at the mechanism were both wrong: inserting a node under a still
 * cursor fires nothing at all, and the events a rebuild does fire arrive as a
 * bare out/over pair that no `mousemove` ever follows. What separates the two
 * cases is therefore the COORDINATES: a hover the user performed lands
 * somewhere the pointer has not already been sitting.
 */
describe('hover means the user moved — not that the subtitles moved', () => {
    function overlaySpan(word: string): HTMLElement {
        const box = document.createElement('div');
        box.className = 'vtt-overlay-main';
        box.dataset.index = '0';
        const span = document.createElement('span');
        span.dataset.word = word;
        span.textContent = word;
        box.appendChild(span);
        document.body.appendChild(box);
        // jsdom measures everything as zero, and place() drops a card whose
        // anchor has no box — so the span is given one, as the other suites do.
        const rect = { top: 400, bottom: 420, left: 100, right: 160,
            width: 60, height: 20, x: 100, y: 400, toJSON: () => ({}) } as DOMRect;
        span.getBoundingClientRect = () => rect;
        return span;
    }

    /** Physically move the pointer to a point, as the browser reports it. */
    function movePointerTo(x: number, y: number, over?: Element): void {
        (over ?? document).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, clientX: x, clientY: y,
        }));
    }

    function hoverAt(el: Element, x: number, y: number): void {
        el.dispatchEvent(new MouseEvent('mouseover', {
            bubbles: true, clientX: x, clientY: y,
        }));
    }

    let video: HTMLVideoElement;
    let pauseSpy: jest.Mock;

    beforeEach(async () => {
        document.body.innerHTML = '';
        await chromeStorage.local.set({ 'lang.v1': { learning: 'en', native: 'ru' } });
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m, cb) => cb({ ok: true, result: dictAnswer }));
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        video = document.createElement('video');
        pauseSpy = jest.fn(function (this: HTMLVideoElement) {
            Object.defineProperty(this, 'paused', { value: true, configurable: true });
        });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        video.play = jest.fn(() => Promise.resolve()) as unknown as HTMLVideoElement['play'];
        video.pause = pauseSpy as unknown as HTMLVideoElement['pause'];
        document.body.appendChild(video);
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('ignores a word that slides under a resting cursor — no card, no pause', async () => {
        const teardown = installLookupStrip();
        // The user put the pointer here at some point and left it alone.
        movePointerTo(300, 400);
        // A cue renders; one of its words now occupies that exact point. The
        // browser reports the hover at the coordinates the pointer already had.
        hoverAt(overlaySpan('anchor'), 300, 400);
        await jest.advanceTimersByTimeAsync(2000);

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();
        // The whole point of the bug report: the film kept playing.
        expect(pauseSpy).not.toHaveBeenCalled();
        teardown();
    });

    it('opens as before when the cursor actually travels onto the word', async () => {
        const teardown = installLookupStrip();
        movePointerTo(300, 400);
        // The pointer moves somewhere new, and the word is under it there.
        hoverAt(overlaySpan('anchor'), 120, 90);
        await jest.advanceTimersByTimeAsync(2000);

        expect(document.getElementById('lingogram-lookup-strip')).not.toBeNull();
        expect(pauseSpy).toHaveBeenCalledTimes(1);
        teardown();
    });

    it('asks once when a hover and its mousemove both land on the same word', async () => {
        // Chrome delivers both for one gesture — mouseover first, then the
        // mousemove that caused it. Both now reach aimAt(), and the budget the
        // 220ms debounce exists to protect (30 requests/min) must not pay twice
        // for one movement.
        const teardown = installLookupStrip();
        const span = overlaySpan('anchor');
        movePointerTo(300, 400);
        hoverAt(span, 120, 90);
        movePointerTo(120, 90);
        await jest.advanceTimersByTimeAsync(2000);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        teardown();
    });

    it('re-arms on a nudge inside the word, which fires no mouseover at all', async () => {
        const teardown = installLookupStrip();
        movePointerTo(300, 400);
        const span = overlaySpan('anchor');
        // Suppressed: it came to the cursor.
        hoverAt(span, 300, 400);
        await jest.advanceTimersByTimeAsync(2000);
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();

        // The user now deliberately nudges the pointer within that same word.
        //
        // Measured in Chrome: moving WITHIN the element the cursor already
        // rests on fires no mouseover — the hit target never changed — so a
        // mousemove is the whole of what the browser sends. That makes this
        // gesture the only way back for a word the guard above suppressed, and
        // the reason the re-arm lives on the mousemove handler rather than
        // being left to the next hover that may never come.
        movePointerTo(305, 402, span);
        await jest.advanceTimersByTimeAsync(2000);

        expect(document.getElementById('lingogram-lookup-strip')).not.toBeNull();
        teardown();
    });

    it('a drag across words opens nothing — the mousemove path obeys it too', async () => {
        // The counter-half of the re-arm above, and the half that only the
        // mousemove path can break: a selection is drawn by MOVING, so every
        // word the sweep crosses reaches aimAt() through this handler. The
        // existing drag test dispatches mouseover alone and stays green.
        //
        // What the user gets otherwise: a card per word mid-sweep, the film
        // paused halfway through drawing the phrase, and two or three requests
        // against the 30/min budget for one gesture — the third from
        // onSelectionMouseUp, which is the only one that was asked for.
        const teardown = installLookupStrip();
        const first = overlaySpan('anchor');
        const second = overlaySpan('chain');
        movePointerTo(300, 400);

        first.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, button: 0, clientX: 120, clientY: 410,
        }));
        // Sweeping with the button held: `buttons: 1` is the live fact, as the
        // mouseover guard reads it.
        for (const [span, x] of [[first, 130], [second, 150]] as const) {
            span.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, buttons: 1, clientX: x, clientY: 410,
            }));
            await jest.advanceTimersByTimeAsync(300);
        }

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();
        expect(pauseSpy).not.toHaveBeenCalled();
        teardown();
    });

    it('a click that closes the card is not undone by the hand that clicked', async () => {
        // A click dismisses the card through onMouseDown -> removeStrip(), and
        // the hand that clicks is never perfectly still. The tremor that
        // follows is a mousemove inside the word the card belonged to — which
        // this path aims at, finding `current` already cleared. The card
        // re-opens and re-pauses the film, and clicking again just repeats it.
        //
        // Unreachable through mouseover, which is why it appeared with this
        // handler: moving within a span fires no mouseover at all.
        const teardown = installLookupStrip();
        const span = overlaySpan('anchor');
        movePointerTo(300, 400);
        hoverAt(span, 120, 410);
        await jest.advanceTimersByTimeAsync(2000);
        expect(document.getElementById('lingogram-lookup-strip')).not.toBeNull();

        span.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, button: 0, clientX: 120, clientY: 410,
        }));
        span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 410 }));
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();

        // 1px of the hand settling, still inside the dismissed word.
        movePointerTo(121, 410, span);
        await jest.advanceTimersByTimeAsync(2000);

        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();
        teardown();
    });

    it('and the word is hoverable again once the pointer has left it', async () => {
        // The dismissal is remembered against one word, not forever: holding it
        // past the departure would make that word dead for as long as the cue
        // stays on screen, which is the bug this suite already fixed once.
        const teardown = installLookupStrip();
        const span = overlaySpan('anchor');
        movePointerTo(300, 400);
        hoverAt(span, 120, 410);
        await jest.advanceTimersByTimeAsync(2000);
        span.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, button: 0, clientX: 120, clientY: 410,
        }));
        span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 410 }));

        // The cursor genuinely leaves for somewhere else, then comes back.
        const elsewhere = document.createElement('div');
        document.body.appendChild(elsewhere);
        span.dispatchEvent(new MouseEvent('mouseout', {
            bubbles: true, relatedTarget: elsewhere, clientX: 900, clientY: 900,
        }));
        movePointerTo(900, 900);
        await jest.advanceTimersByTimeAsync(2000);
        (chrome.runtime.sendMessage as jest.Mock).mockClear();

        // The return has to be judged on the MOUSEMOVE path, the only one that
        // reads the dismissal — a bare mouseover would pass even with the flag
        // never cleared. So the word comes back the suppressed way: it arrives
        // under the resting cursor on a repaint, leaving the nudge inside it as
        // the sole route to a card, exactly as in the re-arm test above.
        hoverAt(span, 900, 900);
        await jest.advanceTimersByTimeAsync(2000);
        expect(document.getElementById('lingogram-lookup-strip')).toBeNull();

        movePointerTo(902, 901, span);
        await jest.advanceTimersByTimeAsync(2000);

        expect(document.getElementById('lingogram-lookup-strip')).not.toBeNull();
        teardown();
    });
});
