/**
 * @jest-environment jsdom
 */

// The HDrezka edition's settings page: the pickers are limited to the
// subtitle languages HDrezka ships, and the privacy switch (which moved here
// from the popup) keeps its behaviour.

const sendMessageMock = jest.fn();

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
    storage: {
        local: storageLocal,
        session: { get: jest.fn(async () => ({})) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

import { SUBTITLE_LANGUAGES } from '../src/config';

beforeEach(() => {
    document.body.innerHTML = '<main id="page"></main>';
    sendMessageMock.mockReset();
    sendMessageMock.mockImplementation((_msg, cb) => {
        if (typeof cb === 'function') cb({ signedIn: false, inboxCount: 0 });
    });
    Object.keys(prefsStore).forEach((k) => delete prefsStore[k]);
    storageLocal.get.mockClear();
    storageLocal.set.mockClear();
    jest.resetModules();
});

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(): Promise<void> {
    await import('../src/settings/settings');
    await nextTick();
}

describe('settings page, HDrezka edition', () => {
    test('both language pickers offer exactly the subtitle languages HDrezka ships', async () => {
        await mount();

        const selects = document.querySelectorAll<HTMLSelectElement>('.lang-select');
        expect(selects).toHaveLength(2);
        for (const select of selects) {
            const offered = Array.from(select.options).map((o) => o.value);
            expect(offered).toEqual(['', ...SUBTITLE_LANGUAGES]);
        }
    });

    test('has the HDrezka switch and the highlight, and no YouTube hint', async () => {
        await mount();

        const labels = Array.from(document.querySelectorAll('.group .row-label')).map((n) => n.textContent);
        expect(labels).toContain('Subtitles on HDrezka');
        expect(labels).not.toContain('Subtitles on YouTube');
        expect(document.body.textContent).not.toContain('Dual subtitles and the word list next to the video.');
    });
});

describe('privacy toggle', () => {
    const checkbox = () =>
        document.querySelector<HTMLInputElement>('input[data-pref="analyticsEnabled"]');

    test('renders checked by default', async () => {
        // Analytics is on unless turned off, and a privacy control that flashes
        // "off" before correcting itself reads worse than the reverse.
        await mount();
        expect(checkbox()).not.toBeNull();
        expect(checkbox()!.checked).toBe(true);
    });

    test('reflects a stored opt-out', async () => {
        prefsStore['prefs.v1'] = { analyticsEnabled: false };
        await mount();
        expect(checkbox()!.checked).toBe(false);
    });

    test('unchecking persists the opt-out and sends the final event', async () => {
        // The event goes out BEFORE the preference is written, so this last hit
        // still passes the gate in analytics-bg.
        await mount();

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
        await mount();

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
