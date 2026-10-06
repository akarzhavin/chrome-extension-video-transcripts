/**
 * @jest-environment jsdom
 */

/**
 * A dev build can be switched to another backend at runtime, and the choice is
 * stored in `dev.targetEnv`. Only the service worker used to apply it, so the
 * extension's own pages kept the build's home frontend in every link they
 * built. These tests pin that the popup, the words page and the settings page
 * restore the stored side before they render and follow it while open, and
 * that the popup's dev chip shows the side and advances the ring.
 */

const HOME_URL = 'https://home.example.com';
const PREPROD_URL = 'https://preprod.example.com';
const RING = [
    {
        name: 'preprod',
        projectId: 'project-preprod',
        apiKey: 'key-preprod',
        frontendBaseUrl: PREPROD_URL,
        apiBaseUrl: 'https://api-preprod.example.com',
    },
    {
        name: 'prod',
        projectId: 'lingogram-prod',
        apiKey: 'key-prod',
        frontendBaseUrl: 'https://prod.example.com',
        apiBaseUrl: 'https://api-prod.example.com',
    },
];

const store: Record<string, unknown> = {};
const storageListeners: Array<(changes: Record<string, any>, area: string) => void> = [];
const tabsCreate = jest.fn(async () => ({}));
const sendMessage = jest.fn();

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        getURL: (p: string) => `chrome-extension://test-extension-id/${p}`,
        sendMessage,
        openOptionsPage: jest.fn(async () => undefined),
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    tabs: { create: tabsCreate, query: jest.fn(async () => []) },
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? store);
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                Object.assign(store, items);
            }),
        },
        session: { get: jest.fn(async () => ({})) },
        onChanged: { addListener: jest.fn((l: any) => storageListeners.push(l)), removeListener: jest.fn() },
    },
};

import { readFileSync } from 'fs';
import { join } from 'path';

const bodyOf = (rel: string): string => {
    const file = readFileSync(join(__dirname, '..', 'src', rel), 'utf8');
    return /<body>([\s\S]*?)<\/body>/.exec(file)![1].replace(/<script[\s\S]*?<\/script>/g, '');
};

function setBuild(targets: unknown[]): void {
    (global as any).__EXT_ENV__ = 'dev';
    (global as any).__FRONTEND_BASE_URL__ = HOME_URL;
    (global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
    (global as any).__FIREBASE_API_KEY__ = 'demo';
    (global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
    (global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
    (global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
    (global as any).__EXT_API_BASE_URL__ = 'https://api-local.example.com';
    (global as any).__EXT_HOME_TARGET_NAME__ = 'local';
    (global as any).__EXT_DEV_TARGETS__ = targets.length ? JSON.stringify(targets) : '';
}

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await nextTick();
};

/** The worker's side of the dev actions, tracking which side is live. */
let live = 'local';
let status: Record<string, unknown> = { signedIn: true, inboxCount: 3, localCount: 0 };
function envState(): Record<string, unknown> {
    const names = ['local', 'preprod', 'prod'];
    return {
        side: live,
        label: live,
        canSwitch: ringSize > 1,
        isProd: live === 'prod',
        targets: names,
        next: names[(names.indexOf(live) + 1) % names.length],
    };
}
let ringSize = 3;

beforeEach(() => {
    jest.resetModules();
    setBuild(RING);
    for (const k of Object.keys(store)) delete store[k];
    storageListeners.length = 0;
    tabsCreate.mockClear();
    live = 'local';
    ringSize = 3;
    status = { signedIn: true, inboxCount: 3, localCount: 0 };
    window.close = jest.fn();
    sendMessage.mockReset().mockImplementation((msg: any, cb: any) => {
        if (typeof cb !== 'function') return;
        switch (msg?.action) {
            case 'AUTH_STATUS':
                return cb(status);
            case 'DEV_GET_ENV':
                return cb(envState());
            case 'DEV_SET_ENV': {
                const s = envState();
                live = s.next as string;
                // The worker parks/unparks per side: the other side is signed out.
                status = live === 'preprod' ? { signedIn: false, inboxCount: 0, localCount: 0 } : status;
                return cb({ ok: true, ...envState() });
            }
            default:
                return cb({});
        }
    });
});

const actions = (): string[] => sendMessage.mock.calls.map((c) => c[0].action);
const rowByLabel = (root: HTMLElement, label: string): HTMLElement =>
    [...root.querySelectorAll<HTMLElement>('.mi')].find((r) => r.querySelector('.l')?.textContent === label)!;

describe('the popup follows the stored backend', () => {
    beforeEach(() => {
        document.body.innerHTML = bodyOf('popup/popup.html');
    });

    test('"My vocabulary" opens the stored side\'s frontend', async () => {
        store['dev.targetEnv'] = 'preprod';
        status = { signedIn: true, inboxCount: 3, localCount: 0 };
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        rowByLabel(document.getElementById('root')!, 'My vocabulary').click();
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({ url: `${PREPROD_URL}/app/vocab` });
    });

    test('"Settings" opens the stored side\'s site settings when signed in', async () => {
        store['dev.targetEnv'] = 'preprod';
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        rowByLabel(document.getElementById('root')!, 'Settings').click();
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({
            url: `${PREPROD_URL}/app/vocab/extension?ext=test-extension-id&edition=youtube`,
        });
    });

    test('with nothing stored the home frontend is used', async () => {
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        rowByLabel(document.getElementById('root')!, 'My vocabulary').click();
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({ url: `${HOME_URL}/app/vocab` });
    });
});

describe('the popup\'s dev backend chip', () => {
    beforeEach(() => {
        document.body.innerHTML = bodyOf('popup/popup.html');
    });
    const chip = (): HTMLButtonElement | null => document.querySelector('#root .mhd button');

    test('shows the live side, with the next stop in its accessible name', async () => {
        live = 'preprod';
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        expect(chip()!.textContent).toBe('preprod');
        expect(chip()!.getAttribute('aria-label')).toBe('Backend: preprod. Switch to prod');
        expect(chip()!.dataset.env).toBe('safe');
    });

    test('marks production', async () => {
        live = 'prod';
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        expect(chip()!.textContent).toBe('prod');
        expect(chip()!.dataset.env).toBe('live');
        expect(chip()!.style.color).toBe('var(--lg-danger)');
    });

    test('a click advances the ring without naming a side, then re-renders the new account state', async () => {
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        expect(chip()!.textContent).toBe('local');
        expect(document.querySelector('#root')!.textContent).toContain('My vocabulary');

        chip()!.click();
        await settle();

        const set = sendMessage.mock.calls.map((c) => c[0]).filter((m) => m.action === 'DEV_SET_ENV');
        expect(set).toEqual([{ action: 'DEV_SET_ENV' }]);
        expect(chip()!.textContent).toBe('preprod');
        expect(document.querySelector('#root')!.textContent).not.toContain('My vocabulary');
        expect(document.querySelector('#root')!.textContent).toContain('Sign in on Lingogram');
    });

    test('is hidden when the build has nowhere to switch to', async () => {
        ringSize = 1;
        const { initPopup } = await import('../src/popup/popup');
        initPopup({ edition: 'youtube' });
        await settle();
        expect(actions()).toContain('DEV_GET_ENV');
        expect(chip()).toBeNull();
    });
});

describe('the words page follows the stored backend', () => {
    beforeEach(() => {
        document.body.innerHTML = bodyOf('words/words.html');
    });

    test('"Open my vocabulary" opens the stored side\'s frontend', async () => {
        store['dev.targetEnv'] = 'preprod';
        const { initWords } = await import('../src/words/words');
        initWords();
        await settle();
        const open = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open my vocabulary')!;
        open.click();
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({ url: `${PREPROD_URL}/app/vocab` });
    });

    test('a changed dev.targetEnv while open re-applies and repaints', async () => {
        const { initWords } = await import('../src/words/words');
        initWords();
        await settle();
        const before = actions().filter((a) => a === 'AUTH_STATUS').length;

        for (const l of storageListeners) l({ 'dev.targetEnv': { newValue: 'preprod' } }, 'local');
        await settle();

        expect(actions().filter((a) => a === 'AUTH_STATUS').length).toBeGreaterThan(before);
        const open = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open my vocabulary')!;
        open.click();
        await settle();
        expect(tabsCreate).toHaveBeenCalledWith({ url: `${PREPROD_URL}/app/vocab` });
    });
});

describe('the settings page follows the stored backend', () => {
    beforeEach(() => {
        document.body.innerHTML = bodyOf('settings/settings.html');
    });

    test('restores the stored side before the account group is painted', async () => {
        store['dev.targetEnv'] = 'preprod';
        const { config } = await import('../src/auth/config');
        const { initSettings } = await import('../src/settings/settings');
        initSettings({ edition: 'youtube' });
        await settle();
        expect(config.frontendBaseUrl).toBe(PREPROD_URL);
    });

    test('a changed dev.targetEnv while open re-applies and repaints the account', async () => {
        const { config } = await import('../src/auth/config');
        const { initSettings } = await import('../src/settings/settings');
        initSettings({ edition: 'youtube' });
        await settle();
        expect(config.frontendBaseUrl).toBe(HOME_URL);
        const before = actions().filter((a) => a === 'AUTH_STATUS').length;

        for (const l of storageListeners) l({ 'dev.targetEnv': { newValue: 'preprod' } }, 'local');
        await settle();

        expect(config.frontendBaseUrl).toBe(PREPROD_URL);
        expect(actions().filter((a) => a === 'AUTH_STATUS').length).toBeGreaterThan(before);
    });
});
