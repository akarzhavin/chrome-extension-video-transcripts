/**
 * @jest-environment jsdom
 */

const sendMessageMock = jest.fn();

// The privacy toggle reads and writes prefs, so this suite needs a storage
// stub too — without one loadPrefs() bails to defaults and the checkbox's
// stored state could never be observed.
const prefsStore: Record<string, unknown> = {};
const storageLocal = {
    get: jest.fn((keys: string | string[] | null) => {
        if (keys == null) return Promise.resolve({ ...prefsStore });
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in prefsStore) out[k] = prefsStore[k];
        return Promise.resolve(out);
    }),
    set: jest.fn((items: Record<string, unknown>) => {
        Object.assign(prefsStore, items);
        return Promise.resolve();
    }),
};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: sendMessageMock,
        lastError: undefined,
    },
    storage: { local: storageLocal, onChanged: { addListener: jest.fn() } },
};

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessageMock.mockReset();
    Object.keys(prefsStore).forEach((k) => delete prefsStore[k]);
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
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

describe('privacy toggle', () => {
    const signedOut = () =>
        sendMessageMock.mockImplementation((msg, cb) => {
            if (typeof cb === 'function') cb({ signedIn: false, inboxCount: 0 });
        });

    const checkbox = () =>
        document.querySelector<HTMLInputElement>('.toggle-row input[type="checkbox"]');

    test('renders checked by default', async () => {
        // Analytics is on unless turned off, and a privacy control that flashes
        // "off" before correcting itself reads worse than the reverse.
        signedOut();
        await import('../src/popup/popup');
        await nextTick();
        expect(checkbox()).not.toBeNull();
        expect(checkbox()!.checked).toBe(true);
    });

    test('reflects a stored opt-out', async () => {
        prefsStore['prefs.v1'] = { analyticsEnabled: false };
        signedOut();
        await import('../src/popup/popup');
        await nextTick();
        expect(checkbox()!.checked).toBe(false);
    });

    test('unchecking persists the opt-out and sends the final event', async () => {
        // The event goes out BEFORE the preference is written, so this last hit
        // still passes the gate in analytics-bg.
        signedOut();
        await import('../src/popup/popup');
        await nextTick();

        sendMessageMock.mockClear();
        const box = checkbox()!;
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        await nextTick();

        const tracked = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT');
        expect(tracked).toHaveLength(1);
        expect(tracked[0].event).toBe('analytics_opt_out');
        expect((prefsStore['prefs.v1'] as any).analyticsEnabled).toBe(false);
    });

    test('re-enabling persists but sends nothing', async () => {
        // Opting back in isn't tracked: analytics is already on for everyone,
        // so the event would only ever measure re-enables.
        prefsStore['prefs.v1'] = { analyticsEnabled: false };
        signedOut();
        await import('../src/popup/popup');
        await nextTick();

        sendMessageMock.mockClear();
        const box = checkbox()!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await nextTick();

        const tracked = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT');
        expect(tracked).toHaveLength(0);
        expect((prefsStore['prefs.v1'] as any).analyticsEnabled).toBe(true);
    });
});
