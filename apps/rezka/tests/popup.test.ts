/**
 * @jest-environment jsdom
 */

const sendMessageMock = jest.fn();

(global as any).chrome = {
    runtime: {
        sendMessage: sendMessageMock,
        lastError: undefined,
    },
};

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessageMock.mockReset();
    jest.resetModules();
});

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('popup', () => {
    test('renders sign-in button when not signed in (dev)', async () => {
        sendMessageMock.mockImplementationOnce((_msg, cb) => {
            cb({ signedIn: false, inboxCount: 0 });
        });

        await import('../src/popup/popup');
        await nextTick();

        const root = document.getElementById('root')!;
        expect(root.querySelector('h1')?.textContent).toContain('Lingogram');
        expect(root.querySelector('input[type="email"]')).toBeNull();
        expect(root.querySelector('input[type="password"]')).toBeNull();
        const primary = root.querySelector('button.primary');
        expect(primary?.textContent).toContain('Sign in on lingogram');
        // Dev hides the native-Google fallback (which requires a stable extension ID).
        expect(root.querySelector('button.secondary')).toBeNull();
    });

    test('renders signed-in view with email and count', async () => {
        sendMessageMock.mockImplementationOnce((_msg, cb) => {
            cb({ signedIn: true, email: 'student@example.com', uid: 'u-1', inboxCount: 7 });
        });

        await import('../src/popup/popup');
        await nextTick();

        const root = document.getElementById('root')!;
        expect(root.querySelector('.email')?.textContent).toBe('student@example.com');
        expect(root.querySelector('.count')?.textContent).toContain('7 words');
        expect(root.querySelector('button')?.textContent).toBe('Sign out');
    });
});
