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

/**
 * Behaviour map §2.6 / §25.1-25.3 — the signed-IN half of the row.
 *
 * Everything above drives the signed-out branch. The signed-in one was named
 * only by e2e/signing-in.spec.ts:372, which sits behind LINGOGRAM_STAND_ACCOUNT
 * and never runs without a live account — so these claims were, in practice,
 * unchecked. Nothing here needs an account: the row renders from whatever
 * AUTH_STATUS answers.
 */
const signedInAs = (email: string, inboxCount = 0): void => {
    sendMessage.mockImplementation((m: any) =>
        m?.action === 'AUTH_STATUS' ? { signedIn: true, email, inboxCount } : { ok: true });
};

describe('the row when someone is signed in', () => {
    test('shows the address, with a dot instead of the invitation', async () => {
        signedInAs('reader@example.com', 7);
        await mount();

        expect(row()!.textContent).toContain('reader@example.com');
        // The invitation must be GONE, not merely joined: a row showing both
        // would be telling the person to sign in while signed in.
        expect(row()!.textContent).not.toMatch(/sign in to save words/i);
    });

    test('says who is signed in and how many words are saved, without opening it', async () => {
        signedInAs('reader@example.com', 7);
        await mount();

        // The hover title carries the same three facts as the panel, so the
        // count is readable without a click — and screen readers get it too.
        expect(row()!.title).toContain('reader@example.com');
        expect(row()!.title).toContain('7 words saved');
        expect(row()!.getAttribute('aria-label')).toBe(row()!.title);
    });
});

describe('the panel when someone is signed in', () => {
    test('offers the address, the count and the way out', async () => {
        signedInAs('reader@example.com', 7);
        await mount();
        row()!.click();

        const text = panel()!.textContent ?? '';
        expect(text).toContain('Signed in as');
        expect(text).toContain('reader@example.com');
        expect(text).toContain('7 words saved');
        expect([...panel()!.querySelectorAll('button')].map((b) => b.textContent)).toContain(
            'Sign out',
        );
    });

    test('zero saved words is a number, not a blank', async () => {
        signedInAs('reader@example.com', 0);
        await mount();
        row()!.click();

        expect(panel()!.textContent).toContain('0 words saved');
    });

    test('signing out from the panel closes it and returns the invitation', async () => {
        signedInAs('reader@example.com', 3);
        await mount();
        row()!.click();

        const signOut = [...panel()!.querySelectorAll('button')].find(
            (b) => b.textContent === 'Sign out',
        )!;
        // The next status read must answer as a signed-out person.
        sendMessage.mockImplementation((m: any) =>
            m?.action === 'AUTH_STATUS' ? { signedIn: false } : { ok: true });
        signOut.click();
        await flush();

        expect(panel()).toBeNull();
        expect(row()!.textContent).toMatch(/sign in to save words/i);
    });
});

/**
 * §25.3: the row updates live. A word saved from the toolbar popup changes the
 * count in the panel, and the reverse — the two surfaces must not drift.
 *
 * No test in the tree had ever FIRED chrome.storage.onChanged: every suite
 * mocks addListener as a bare jest.fn(), so the whole listener could be deleted
 * and nothing would notice. Here the registered callback is pulled back off the
 * mock and invoked, which is what the browser does.
 */
describe('the row follows changes made elsewhere', () => {
    /** The listener the badge registered, as the browser would call it. */
    const fireStorageChange = async (
        changes: Record<string, unknown>,
        area = 'local',
    ): Promise<void> => {
        const calls = (chrome.storage.onChanged.addListener as jest.Mock).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [listener] of calls) listener(changes, area);
        await flush();
    };

    test('a word saved on another surface updates the count here', async () => {
        signedInAs('reader@example.com', 7);
        await mount();
        expect(row()!.title).toContain('7 words saved');

        signedInAs('reader@example.com', 8);
        await fireStorageChange({ 'inbox.count': { newValue: 8 } });

        expect(row()!.title).toContain('8 words saved');
    });

    test('signing in elsewhere replaces the invitation', async () => {
        await mount();
        expect(row()!.textContent).toMatch(/sign in to save words/i);

        signedInAs('reader@example.com', 1);
        await fireStorageChange({ 'auth.idToken': { newValue: 'tok' } });

        expect(row()!.textContent).toContain('reader@example.com');
    });

    /**
     * The half that stops "re-render on anything" passing. Unrelated keys — and
     * a different storage area — change constantly; re-rendering on each would
     * make the row flicker and cost a message round-trip every time.
     */
    test('an unrelated change leaves it alone', async () => {
        signedInAs('reader@example.com', 7);
        await mount();
        sendMessage.mockClear();

        await fireStorageChange({ 'prefs.v1': { newValue: {} } });
        await fireStorageChange({ 'inbox.count': { newValue: 9 } }, 'sync');

        expect(sendMessage).not.toHaveBeenCalled();
    });
});
