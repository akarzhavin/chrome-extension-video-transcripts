/**
 * @jest-environment jsdom
 *
 * The feedback screen as a user meets it: mounted, focused and typed into.
 * The pure helpers are covered in feedback-screen.test.ts; these are the
 * defects that only show up once the form is on screen.
 */

const sendMessage = jest.fn((_msg: object, cb?: (r: unknown) => void) => cb?.({ signedIn: false }));

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        sendMessage,
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getManifest: () => ({ version: '1.2.3' }),
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en-US' }, // force English fallbacks
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { AppState } from '../src/AppState';
import { SidebarUI } from '../src/SidebarUI';
import { MAX_FEEDBACK_BYTES, utf8Len } from '../src/feedback';

const app = {
    updateHighlight: () => {},
    seekVideo: () => {},
    langPrefs: { learning: 'en', native: 'ru' },
};

/** Mount the sidebar and open the feedback screen, as clicking through would. */
async function openForm() {
    document.body.innerHTML = '';
    const ui = new SidebarUI(new AppState(), app as never);
    ui.init();
    ui.openFeedbackScreen();
    // The email row appears after an async auth check.
    await Promise.resolve();
    await Promise.resolve();
    return ui;
}

const textarea = () => document.getElementById('vtt-feedback-text') as HTMLTextAreaElement;
const email = () => document.getElementById('vtt-feedback-email') as HTMLInputElement;
const counter = () => document.querySelector('.vtt-feedback-counter') as HTMLElement;
const type = (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('feedback form', () => {
    test('opens with the message box focused, not the back chip', async () => {
        await openForm();
        expect(document.activeElement).toBe(textarea());
        expect(document.activeElement?.id).not.toBe('vtt-feedback-back-btn');
    });

    // The one that loses user data: the email shares the byte budget, and the
    // clamp used to take the overflow out of the message — text written
    // earlier, in a field the user is no longer looking at.
    test('typing a reply address never eats the message', async () => {
        await openForm();
        const msg = 'A'.repeat(MAX_FEEDBACK_BYTES - 10);
        type(textarea(), msg);
        expect(textarea().value).toBe(msg);

        type(email(), 'someone@example.com');

        expect(textarea().value).toBe(msg);
        expect(textarea().value.length).toBe(msg.length);
    });

    test('an over-long address clamps itself instead', async () => {
        await openForm();
        const msg = 'A'.repeat(MAX_FEEDBACK_BYTES - 10);
        type(textarea(), msg);

        const long = 'b'.repeat(200) + '@example.com';
        type(email(), long);

        expect(textarea().value).toBe(msg); // untouched
        expect(email().value.length).toBeLessThan(long.length); // the typed field gave way
    });

    test('the message still clamps when the message is what overflows', async () => {
        await openForm();
        type(textarea(), 'A'.repeat(MAX_FEEDBACK_BYTES + 500));
        expect(utf8Len(textarea().value)).toBeLessThanOrEqual(MAX_FEEDBACK_BYTES);
    });

    // aria-live reads this out on every keystroke; "12" alone says nothing.
    test('the counter names its unit, for the ear as well as the eye', async () => {
        await openForm();
        type(textarea(), 'A'.repeat(MAX_FEEDBACK_BYTES - 12));

        expect(counter().hidden).toBe(false);
        expect(counter().textContent).toMatch(/characters left/);
        expect(counter().textContent).not.toMatch(/^\d+$/);
        expect(counter().getAttribute('aria-label')).toBe(counter().textContent);
    });

    test('the counter stays out of the way until the limit is near', async () => {
        await openForm();
        type(textarea(), 'short message');
        expect(counter().hidden).toBe(true);
    });
});
