/**
 * @jest-environment jsdom
 *
 * The hover card over a marked word on any web page (page-highlight/card.ts).
 * The pointer is simulated through `markAtPoint`, since jsdom lays nothing out:
 * a mark answers for x in [100, 160] on y = 50.
 */

(global as any).chrome = { i18n: { getMessage: () => '' } };

import { installPageCard, type PageCardDeps, type PageMark } from '../src/page-highlight/card';

const sent: Array<Record<string, unknown>> = [];
let replies: Record<string, unknown>;

const mark = (key: string, terms: string[] = [key]): PageMark => ({
    key,
    terms,
    rect: () => ({ left: 100, top: 40, right: 160, bottom: 60, width: 60, height: 20, x: 100, y: 40 }) as DOMRect,
    contains: (x, y) => x >= 100 && x <= 160 && y === 50,
    context: () => `I had to ${key} the plan.`,
});

let deps: PageCardDeps;
let uninstall: () => void;

/** The card lives in a closed shadow root; reach it through attachShadow. */
let root: ShadowRoot | null = null;
const realAttach = Element.prototype.attachShadow;
beforeAll(() => {
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
        root = realAttach.call(this, { ...init, mode: 'open' });
        return root;
    };
});
afterAll(() => {
    Element.prototype.attachShadow = realAttach;
});

const move = (x: number, y = 50, buttons = 0): void => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons, bubbles: true }));
    jest.advanceTimersByTime(50); // the read throttle
};
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};
const card = (): HTMLElement | null => (document.getElementById('lingogram-page-card') ? root?.querySelector('.card') ?? null : null);
const heart = (): HTMLButtonElement => card()!.querySelector('.heart')!;

beforeEach(() => {
    jest.useFakeTimers();
    sent.length = 0;
    document.body.innerHTML = '';
    root = null;
    replies = {
        LOOKUP_WORD: { ok: true, result: { term: 'scrap', lemma: 'scrap', translations: ['отменить', 'выбросить'], parts_of_speech: [{ tag: 'verb', label: 'verb', senses: [{ translations: ['отменить', 'выбросить'], definition: 'discard', examples: [] }] }], source: 'dict' } },
        REMOVE_WORD: { ok: true },
        ADD_WORD: { ok: true },
    };
    deps = {
        markAtPoint: (x, y) => (x >= 100 && x <= 160 && y === 50 ? mark('scrap') : null),
        active: () => true,
        nativeLang: async () => 'ru',
        send: async <T,>(m: Record<string, unknown>) => {
            sent.push(m);
            return replies[m.action as string] as T;
        },
    };
    uninstall = installPageCard(deps);
});

afterEach(() => {
    uninstall();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

const openCard = async (): Promise<void> => {
    move(120);
    jest.advanceTimersByTime(260);
    await flush();
};

test('a rest on a marked word opens the card with its translation', async () => {
    await openCard();
    expect(card()?.textContent).toContain('отменить');
    expect(card()?.textContent).toContain('выбросить');
    expect(heart().textContent).toBe('Remove');
});

test('only the word is sent to look it up, never the sentence around it', async () => {
    await openCard();
    expect(sent).toEqual([{ action: 'LOOKUP_WORD', term: 'scrap', context: '', targetLang: 'ru', site: 'other' }]);
});

test('passing over a word does not open anything', async () => {
    move(120);
    jest.advanceTimersByTime(100);
    move(300);
    jest.advanceTimersByTime(400);
    await flush();
    expect(sent).toEqual([]);
    expect(card()).toBeNull();
});

test('moving within the word asks once', async () => {
    await openCard();
    move(130);
    move(150);
    jest.advanceTimersByTime(400);
    await flush();
    expect(sent.filter((m) => m.action === 'LOOKUP_WORD')).toHaveLength(1);
});

test('leaving the word closes the card', async () => {
    await openCard();
    move(300);
    jest.advanceTimersByTime(200);
    expect(card()).toBeNull();
});

test('a press is someone selecting text, not a question', async () => {
    move(120, 50, 1);
    jest.advanceTimersByTime(400);
    await flush();
    expect(sent).toEqual([]);
});

test('no card before a native language is chosen', async () => {
    deps.nativeLang = async () => undefined;
    await openCard();
    expect(sent).toEqual([]);
    expect(card()).toBeNull();
});

test('nothing is read while no word is marked on the page', async () => {
    let asked = 0;
    deps.active = () => false;
    const markAt = deps.markAtPoint;
    deps.markAtPoint = (x, y) => {
        asked++;
        return markAt(x, y);
    };
    await openCard();
    expect(asked).toBe(0);
    expect(sent).toEqual([]);
});

test('Remove takes the word off the list, then Save puts it back with its sentence', async () => {
    await openCard();
    heart().click();
    await flush();
    expect(sent.at(-1)).toEqual({ action: 'REMOVE_WORD', term: 'scrap', site: 'other' });
    expect(heart().textContent).toBe('Save');
    expect(heart().classList.contains('saved')).toBe(false);

    heart().click();
    await flush();
    expect(sent.at(-1)).toEqual({ action: 'ADD_WORD', term: 'scrap', context: 'I had to scrap the plan.', site: 'other' });
    expect(heart().textContent).toBe('Remove');
});

// Saved with its full stop, painted on the bare word: Remove must name the
// document that exists. Sending the bare word removed nothing and the click
// looked ignored (prod, 2026-10-06: 167 of 513 saved terms carry punctuation).
test('Remove names the stored forms behind the mark, not the word on the page', async () => {
    deps.markAtPoint = (x, y) => (x >= 100 && x <= 160 && y === 50 ? mark('individual', ['individual.', 'individual']) : null);
    await openCard();
    heart().click();
    await flush();
    expect(sent.filter((m) => m.action === 'REMOVE_WORD')).toEqual([
        { action: 'REMOVE_WORD', term: 'individual.', site: 'other' },
        { action: 'REMOVE_WORD', term: 'individual', site: 'other' },
    ]);
    expect(heart().textContent).toBe('Save');

    // Saved back, it lives under the bare word, and that is what Remove names next.
    heart().click();
    await flush();
    sent.length = 0;
    heart().click();
    await flush();
    expect(sent).toEqual([{ action: 'REMOVE_WORD', term: 'individual', site: 'other' }]);
});

test('a refused removal leaves the heart as it was', async () => {
    replies.REMOVE_WORD = { ok: false };
    await openCard();
    heart().click();
    await flush();
    expect(heart().textContent).toBe('Remove');
});

test('a failed lookup says so and fades', async () => {
    replies.LOOKUP_WORD = { ok: false, error: 'boom' };
    await openCard();
    expect(card()?.textContent).toBe("Couldn't load");
    jest.advanceTimersByTime(2100);
    expect(card()).toBeNull();
});

test('a build without the dictionary shows nothing', async () => {
    replies.LOOKUP_WORD = { ok: false, error: 'lookup not configured' };
    await openCard();
    expect(card()).toBeNull();
});

test('Escape and scrolling close it', async () => {
    await openCard();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card()).toBeNull();
    move(300);
    await openCard();
    expect(card()).not.toBeNull();
    window.dispatchEvent(new Event('scroll'));
    expect(card()).toBeNull();
});
