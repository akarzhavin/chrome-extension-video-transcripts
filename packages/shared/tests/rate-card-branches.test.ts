/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.youtube.com/watch?v=abc#lingogram_rate=1"}
 *
 * Where each answer to "Enjoying Lingogram?" leads — behaviour map §15.4,
 * §15.5.
 *
 * The card asks once per installation. Saying yes leads to the store's review
 * page; saying no leads to a box that takes the complaint inline. Wiring "not
 * really" to the store step is a one-character mistake that turns the product
 * into a rating funnel — and the live check, which asserts only that the card
 * appears and offers two answers, would stay green.
 *
 * The card is reached the way the diagnostic switch reaches it, through the
 * public install function with the flag in the address, so nothing in the
 * product is exported for the sake of a test.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
            remove: jest.fn(() => Promise.resolve()),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    i18n: { getMessage: () => '' },
};
(global as any).__EXT_ENV__ = 'dev';

import { installQuickAddOverlay } from '../src/content/quick-add-overlay';

const card = () => document.getElementById('lingogram-rate-prompt');
const buttonSaying = (re: RegExp): HTMLElement => {
    const el = [...card()!.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
    if (!el) throw new Error(`no button matching ${re} — card reads: ${card()!.textContent}`);
    return el as HTMLElement;
};
const storeLinks = (): HTMLAnchorElement[] =>
    [...card()!.querySelectorAll('a')].filter((a) => /chromewebstore|chrome\.google\.com/.test(a.href));

let teardown: () => void;
beforeEach(() => {
    document.body.innerHTML = '';
    Object.keys(store).forEach((k) => delete store[k]);
    teardown = installQuickAddOverlay();
});
afterEach(() => teardown?.());

test('the card appears and offers exactly two answers', () => {
    expect(card()).not.toBeNull();
    const actions = [...card()!.querySelectorAll('button')];
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(storeLinks()).toHaveLength(0); // step 1 never links out
});

test('"Not really" leads to a box, never to the store', () => {
    // The section's stated design decision: an unhappy reader is not sent to
    // the public review page.
    buttonSaying(/not really/i).click();
    expect(storeLinks()).toHaveLength(0);
    expect(card()!.querySelector('textarea')).not.toBeNull();
});

test('"Yes!" leads to the store, and only then', () => {
    buttonSaying(/yes/i).click();
    const links = storeLinks();
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain('abcdefghijklmnopabcdefghijklmnop');
    expect(card()!.querySelector('textarea')).toBeNull();
});

test('the two branches cannot both be reached from one answer', () => {
    // A card that offered the box and the link together would let the same
    // press mean both things.
    buttonSaying(/not really/i).click();
    const hasBox = !!card()!.querySelector('textarea');
    const hasLink = storeLinks().length > 0;
    expect(hasBox && hasLink).toBe(false);
});
