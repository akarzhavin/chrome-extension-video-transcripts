/**
 * @jest-environment jsdom
 *
 * The account row in the panel header — behaviour map §2.3. Not one test in
 * either suite imported this module, so the only way into the account from
 * inside the panel was covered by nothing.
 *
 * What it must get right for someone signed out: say that saving needs an
 * account, and open the sign-in panel when pressed. A row that says the right
 * thing but opens nothing looks identical in a screenshot.
 */

const sendMessage = jest.fn();

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        sendMessage: (msg: object, cb?: (r: unknown) => void) => cb?.(sendMessage(msg)),
        getURL: (p: string) => `chrome-extension://test/${p}`,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en-US' }, // force English fallbacks
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

import { installAuthStatusBadge } from '../src/content/auth-status-badge';

/** The panel header the badge inserts itself into. */
function header(): void {
    document.body.innerHTML = '<div id="vtt-header"><div id="vtt-header-top"></div></div>';
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const row = () => document.querySelector<HTMLButtonElement>('.lingogram-auth-row');
const panel = () => document.getElementById('lingogram-auth-panel');

let teardown: (() => void) | undefined;

beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockImplementation((m: any) =>
        m?.action === 'AUTH_STATUS' ? { signedIn: false } : { ok: true });
    header();
});

afterEach(() => {
    teardown?.();
    teardown = undefined;
});

async function mount(): Promise<void> {
    teardown = installAuthStatusBadge();
    await flush();
}

test('the row states that saving needs an account', async () => {
    await mount();
    expect(row()).not.toBeNull();
    // Pinned to the words a signed-out user must see, not to whatever the row
    // happens to render — a comparison with itself would pass on an empty row.
    expect(row()!.textContent).toMatch(/sign in to save words/i);
    expect(row()!.getAttribute('aria-expanded')).toBe('false');
});

test('pressing it opens the sign-in panel', async () => {
    await mount();
    expect(panel()).toBeNull();

    row()!.click();

    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toMatch(/sign in/i);
    expect(row()!.getAttribute('aria-expanded')).toBe('true');
});

test('the panel offers exactly one way in, and pressing it asks the background once', async () => {
    await mount();
    row()!.click();

    const buttons = panel()!.querySelectorAll('button');
    expect(buttons).toHaveLength(1);

    sendMessage.mockClear();
    buttons[0].click();
    await flush();

    const signIn = sendMessage.mock.calls
        .map(([m]) => m)
        .filter((m: any) => m?.action === 'AUTH_SIGN_IN_VIA_LINGOGRAM');
    expect(signIn).toHaveLength(1);
});

test('a successful sign-in closes the panel', async () => {
    await mount();
    row()!.click();
    panel()!.querySelector('button')!.click();
    await flush();
    expect(panel()).toBeNull();
});

// A refusal has to stay on screen and stay usable: closing the panel on failure
// would drop the message with it, leaving a row that appears to do nothing.
test('a refused sign-in says so and leaves the button usable', async () => {
    sendMessage.mockImplementation((m: any) =>
        m?.action === 'AUTH_STATUS' ? { signedIn: false } : { ok: false, error: 'the tab would not open' });
    await mount();
    row()!.click();

    const button = panel()!.querySelector('button')!;
    button.click();
    await flush();

    expect(panel()).not.toBeNull();
    const alert = panel()!.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/the tab would not open/);
    expect(alert.style.display).not.toBe('none');
    expect(button.disabled).toBe(false);
});

test('a second press closes the panel again', async () => {
    await mount();
    row()!.click();
    expect(panel()).not.toBeNull();
    row()!.click();
    expect(panel()).toBeNull();
    expect(row()!.getAttribute('aria-expanded')).toBe('false');
});

// The row is the only way into the account panel, so a keyboard user needs a
// way out that isn't tabbing through every control in it.
test('Escape closes the panel and hands focus back to the row', async () => {
    await mount();
    row()!.click();
    row()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(row());
});

// An unreachable background is not an account: showing a signed-in row there
// would offer a sign-out that cannot work and hide the way in.
test('an unreachable background renders the signed-out row', async () => {
    sendMessage.mockImplementation(() => { throw new Error('no receiving end'); });
    await mount();
    expect(row()!.textContent).toMatch(/sign in to save words/i);
});
