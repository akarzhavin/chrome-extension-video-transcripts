/**
 * @jest-environment jsdom
 *
 * The feedback screen as a user meets it: mounted, focused and typed into.
 * The pure helpers are covered in feedback-screen.test.ts; these are the
 * defects that only show up once the form is on screen.
 */

// The reply-address field is decided by this answer, so the whole file's
// default is "signed out" and the two tests that care set it themselves.
let authReply: { signedIn?: boolean } | undefined = { signedIn: false };
let authFails = false;
const sendMessage = jest.fn((msg: object, cb?: (r: unknown) => void) => {
    if ((msg as { action?: string }).action === 'AUTH_STATUS') {
        if (authFails) {
            (global as any).chrome.runtime.lastError = { message: 'no receiving end' };
            cb?.(undefined);
            (global as any).chrome.runtime.lastError = undefined;
            return;
        }
        cb?.(authReply);
        return;
    }
    cb?.({ signedIn: false });
});

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
// The takeover's other half lives in the stylesheet; read it directly.
import { readFileSync } from 'fs';
import { join } from 'path';

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

// Who gets asked for a reply address. The field is built either way and its
// row is unhidden only for people the extension cannot already reach — asking
// a signed-in user for an address they already gave reads as a form that
// wasn't paying attention.
describe('the reply address', () => {
    afterEach(() => {
        authReply = { signedIn: false };
        authFails = false;
    });

    test('is offered to someone signed out', async () => {
        authReply = { signedIn: false };
        await openForm();
        expect(email()).not.toBeNull();
        expect(email().closest('.vtt-feedback-email-row')?.hidden).toBe(false);
    });

    test('is withheld from someone signed in', async () => {
        authReply = { signedIn: true };
        await openForm();
        // The input exists either way — the row is what carries the decision,
        // so asserting the input's absence would pass against broken code.
        expect(email()).not.toBeNull();
        expect(email().closest('.vtt-feedback-email-row')?.hidden).toBe(true);
    });

    // An unreachable background is not a reason to lose the reply path. The
    // redundancy of asking a signed-in user costs nothing; the alternative
    // silently drops the only way to answer a bug report.
    test('is offered when the account state cannot be determined', async () => {
        authFails = true;
        await openForm();
        expect(email().closest('.vtt-feedback-email-row')?.hidden).toBe(false);
    });

    test('a reply from a background that answers nothing is treated as signed out', async () => {
        authReply = undefined;
        await openForm();
        expect(email().closest('.vtt-feedback-email-row')?.hidden).toBe(false);
    });
});

/**
 * §21.1, T5.29 — the report form is a takeover, not an overlay.
 *
 * The transcript keeps scrolling behind anything mounted over it, and a form
 * over a moving list is unreadable — the user typing a report is trying to
 * describe what went wrong, not race the video.
 *
 * The hiding is CSS keyed on .vtt-feedback-open, so both halves are pinned: the
 * class the module writes, and the rule the stylesheet keys on it. Either one
 * alone can be removed with the other still green.
 */
describe('the report form covers the transcript', () => {
    const CSS = readFileSync(
        join(__dirname, '../../../apps/rezka/src/assets/styles.css'),
        'utf8',
    );

    it('opening the form marks the panel as taken over', async () => {
        await openForm();
        expect(document.getElementById('vtt-sidebar')!.classList.contains('vtt-feedback-open'))
            .toBe(true);
    });

    it('closing it hands the panel back', async () => {
        const ui = await openForm();
        ui.closeFeedbackScreen();
        expect(document.getElementById('vtt-sidebar')!.classList.contains('vtt-feedback-open'))
            .toBe(false);
    });

    // The stylesheet half: under that class the transcript is display:none.
    // rezka owns the file and the YouTube build copies it verbatim.
    it('the stylesheet hides the transcript under that class', () => {
        // The selector shares a grouped rule with the settings panel, the
        // sub-header and the notification banner, so the match takes whatever
        // list of selectors precedes the block and checks the block's body.
        const rule = /([^{}]*#vtt-sidebar\.vtt-feedback-open\s+#vtt-list\s*)\{([^}]*)\}/.exec(CSS);
        expect(rule).not.toBeNull();
        expect(rule![2]).toMatch(/display:\s*none/);
    });

    // And the form itself is shown by the same class — otherwise "hide the
    // list" would leave the user looking at an empty panel.
    it('the same class is what shows the form', () => {
        const rule = /#vtt-sidebar\.vtt-feedback-open\s+#vtt-feedback-panel\s*\{([^}]*)\}/.exec(CSS);
        expect(rule).not.toBeNull();
        expect(rule![1]).toMatch(/display:\s*flex/);
    });

    // The list is still in the DOM, not destroyed: closing the form has to
    // return the reader to the transcript they left, scroll position included.
    it('the transcript survives the takeover and comes back', async () => {
        const ui = await openForm();
        expect(document.getElementById('vtt-list')).not.toBeNull();

        ui.closeFeedbackScreen();
        expect(document.getElementById('vtt-list')).not.toBeNull();
    });
});
