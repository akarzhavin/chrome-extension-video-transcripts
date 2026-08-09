/**
 * @jest-environment jsdom
 */

import { clampToBytes, composeFeedbackText, sendFeedback, utf8Len } from '../src/feedback';

const sendMessage = jest.fn();

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        sendMessage,
        getManifest: () => ({ version: '1.2.3' }),
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en-US' },
};

beforeEach(() => {
    sendMessage.mockReset();
    (global as any).chrome.runtime.lastError = undefined;
});

/** Resolve the background callback with `res`. */
function backgroundReplies(res: unknown): void {
    sendMessage.mockImplementation((_msg: object, cb: (r: unknown) => void) => cb(res));
}

describe('clampToBytes', () => {
    test('leaves a message inside the budget untouched', () => {
        expect(clampToBytes('hello', 2000)).toBe('hello');
    });

    test('clamps on UTF-8 bytes, not UTF-16 code units', () => {
        // Cyrillic is 2 bytes per char, so 10 chars is 20 bytes. A naive
        // length-based clamp would keep all 10 at a 10-byte budget.
        const out = clampToBytes('абвгдеёжзи', 10);
        expect(utf8Len(out)).toBeLessThanOrEqual(10);
        expect(out).toBe('абвгд');
    });

    test('never splits a surrogate pair', () => {
        // Each emoji is 4 UTF-8 bytes / 2 UTF-16 units. A 6-byte budget must
        // stop at one emoji rather than emitting half of the second.
        const out = clampToBytes('😀😀', 6);
        expect(out).toBe('😀');
        expect(utf8Len(out)).toBe(4);
    });
});

describe('composeFeedbackText', () => {
    test('returns the bare message when no email is given', () => {
        expect(composeFeedbackText('  it broke  ', '')).toBe('it broke');
    });

    test('prepends the reply address so a clamp cannot truncate it away', () => {
        expect(composeFeedbackText('it broke', 'a@b.com')).toBe('[a@b.com] it broke');
    });

    test('ignores a whitespace-only email', () => {
        expect(composeFeedbackText('it broke', '   ')).toBe('it broke');
    });
});

describe('sendFeedback', () => {
    test('sends the composed text and reports success', async () => {
        backgroundReplies({ ok: true });
        await expect(sendFeedback('it broke', 'a@b.com')).resolves.toBe(true);

        const [payload] = sendMessage.mock.calls[0];
        expect(payload).toMatchObject({
            action: 'SEND_FEEDBACK',
            text: '[a@b.com] it broke',
            version: '1.2.3',
            locale: 'en-US',
        });
    });

    test('reports failure when the background rejects the write', async () => {
        backgroundReplies({ ok: false });
        await expect(sendFeedback('it broke')).resolves.toBe(false);
    });

    test('reports failure instead of throwing when the channel errors', async () => {
        sendMessage.mockImplementation((_msg: object, cb: (r: unknown) => void) => {
            (global as any).chrome.runtime.lastError = { message: 'port closed' };
            cb(undefined);
        });
        await expect(sendFeedback('it broke')).resolves.toBe(false);
    });

    test('refuses to send an empty message', async () => {
        backgroundReplies({ ok: true });
        await expect(sendFeedback('   ')).resolves.toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('clamps an over-budget message before sending', async () => {
        backgroundReplies({ ok: true });
        await expect(sendFeedback('я'.repeat(5000))).resolves.toBe(true);

        const [payload] = sendMessage.mock.calls[0];
        expect(utf8Len((payload as { text: string }).text)).toBeLessThanOrEqual(2000);
    });
});
