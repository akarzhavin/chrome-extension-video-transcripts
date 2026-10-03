/**
 * @jest-environment jsdom
 *
 * The welcome page (specs/welcome-page/spec.md): three steps in a left menu,
 * only the language required, sign-in optional, site switches written to the
 * same prefs the content scripts read.
 */

const store: Record<string, unknown> = {};
const listeners: Array<(c: Record<string, unknown>, area: string) => void> = [];
const sent: any[] = [];
let authStatus: { signedIn: boolean; email?: string } = { signedIn: false };
let siblingAnswers = false;

(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? {});
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                const changes: Record<string, unknown> = {};
                for (const [key, v] of Object.entries(items)) {
                    changes[key] = { newValue: v };
                    store[key] = JSON.parse(JSON.stringify(v));
                }
                listeners.forEach((l) => l(changes, 'local'));
            }),
        },
        onChanged: { addListener: (l: any) => listeners.push(l), removeListener: jest.fn() },
    },
    runtime: {
        id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
        lastError: undefined,
        getURL: (p: string) => `chrome-extension://x/${p}`,
        sendMessage: jest.fn((...args: any[]) => {
            // (extId, msg) → sibling ping; (msg, cb) → own worker.
            if (typeof args[0] === 'string') {
                return siblingAnswers ? Promise.resolve({ ok: true, signedIn: false }) : Promise.reject(new Error('no'));
            }
            const [msg, cb] = args;
            sent.push(msg);
            if (msg.action === 'AUTH_STATUS') cb?.(authStatus);
            else cb?.({ ok: true });
            return undefined;
        }),
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'ru-RU' },
    tabs: { create: jest.fn() },
};

import { doneCount, guessNative, initWelcome, INITIAL_STATE, sitesOf, stepStatuses } from '../src/welcome/welcome';
import { isSiteEnabled, loadPrefs, PREFS_KEY } from '../src/prefs';

const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(): Promise<HTMLElement> {
    document.body.innerHTML = '<div id="welcome-root"></div>';
    await initWelcome({ edition: 'youtube' });
    await flush();
    return document.getElementById('welcome-root')!;
}

const rows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('.wl-step'));
const button = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent === text)!;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    listeners.length = 0;
    sent.length = 0;
    authStatus = { signedIn: false };
    siblingAnswers = false;
});

describe('pure parts', () => {
    test('only the language is required; skipped and done read as such', () => {
        expect(stepStatuses(INITIAL_STATE, false)).toEqual(['required', 'optional', 'optional']);
        expect(stepStatuses({ ...INITIAL_STATE, languageDone: true, skippedAccount: true }, false)).toEqual([
            'done',
            'skipped',
            'optional',
        ]);
        expect(doneCount({ ...INITIAL_STATE, languageDone: true, finished: true }, true)).toBe(3);
    });

    test('each edition switches its own sites and links to the other', () => {
        expect(sitesOf('youtube')).toEqual({ own: ['youtube', 'netflix'], other: ['rezka'] });
        expect(sitesOf('rezka')).toEqual({ own: ['rezka'], other: ['youtube', 'netflix'] });
    });

    test('native language comes from the browser, only if the pickers offer it', () => {
        expect(guessNative('ru-RU', ['en', 'ru'])).toBe('ru');
        expect(guessNative('pt_BR', ['en', 'ru'])).toBe('');
    });
});

describe('site prefs', () => {
    test('on by default, coerced when stored wrong, off when switched off', async () => {
        expect(await isSiteEnabled('netflix')).toBe(true);
        store[PREFS_KEY] = { siteNetflix: 'no', siteYoutube: false };
        expect(await isSiteEnabled('netflix')).toBe(true);
        expect(await isSiteEnabled('youtube')).toBe(false);
    });
});

describe('the page', () => {
    test('opens on Language with the native language guessed, and saves on Continue', async () => {
        const root = await mount();
        expect(rows(root).map((r) => r.querySelector('.wl-step-label')!.textContent)).toEqual([
            'Language',
            'Account',
            'Settings',
        ]);
        expect(rows(root)[0].getAttribute('aria-current')).toBe('step');
        const [learning, native] = Array.from(root.querySelectorAll('select'));
        expect(native.value).toBe('ru');
        expect(learning.value).toBe('en');
        button(root, 'Continue').click();
        await flush();
        expect(store['lang.v1']).toEqual({
            learning: 'en',
            native: 'ru',
        });
        expect(rows(root)[1].getAttribute('aria-current')).toBe('step');
        expect(root.querySelector('.wl-progress-text')!.textContent).toBe('1 of 3 done');
        expect((store['welcome.v1'] as any).step).toBe(1);
    });

    test('account: sign-in goes through the existing handoff; skip marks the row Skipped', async () => {
        store['welcome.v1'] = { step: 1, languageDone: true, skippedAccount: false, finished: false };
        const root = await mount();
        button(root, 'Sign in or create an account').click();
        expect(sent).toContainEqual({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'welcome' });
        button(root, 'Skip for now').click();
        await flush();
        expect(rows(root)[1].querySelector('.wl-step-status')!.textContent).toBe('Skipped');
        expect(rows(root)[2].getAttribute('aria-current')).toBe('step');
    });

    test('a sign-in landing in storage turns the account step to signed in', async () => {
        store['welcome.v1'] = { step: 1, languageDone: true, skippedAccount: false, finished: false };
        const root = await mount();
        authStatus = { signedIn: true, email: 'a@b.c' };
        await (chrome.storage.local.set as any)({ 'auth.uid': 'u1' });
        await flush();
        expect(root.querySelector('.wl-ok')!.textContent).toBe('Signed in as a@b.c on lingogram.ai and in the extension');
        expect(root.querySelector('.wl-progress-text')!.textContent).toBe('2 of 3 done');
    });

    test('settings: own sites are switches writing the prefs; the other edition is a store link', async () => {
        store['welcome.v1'] = { step: 2, languageDone: true, skippedAccount: true, finished: false };
        const root = await mount();
        const titles = Array.from(root.querySelectorAll('.wl-row-title')).map((n) => n.textContent);
        expect(titles).toEqual(['YouTube', 'Netflix', 'HDrezka', 'Highlight my words on websites']);
        const netflix = root.querySelectorAll<HTMLInputElement>('.wl-switch')[1];
        netflix.checked = false;
        netflix.dispatchEvent(new Event('change'));
        await flush();
        expect((await loadPrefs()).siteNetflix).toBe(false);
        const add = button(root, 'Add to Chrome') as HTMLAnchorElement;
        expect(add.href).toBe('https://chromewebstore.google.com/detail/hmdkmkimdbomemfcjmgeclchbcdbhabj');
    });

    test('the other edition installed → "Installed", no store link', async () => {
        siblingAnswers = true;
        store['welcome.v1'] = { step: 2, languageDone: true, skippedAccount: false, finished: false };
        const root = await mount();
        expect(root.querySelector('.wl-installed')!.textContent).toBe('Installed');
        expect(button(root, 'Add to Chrome')).toBeUndefined();
    });

    test('Finish marks setup finished', async () => {
        store['welcome.v1'] = { step: 2, languageDone: true, skippedAccount: true, finished: false };
        const root = await mount();
        // jsdom cannot navigate; the state is what the popup reads.
        const nav = jest.spyOn(console, 'error').mockImplementation(() => {});
        button(root, 'Finish and open YouTube').click();
        await flush();
        nav.mockRestore();
        expect((store['welcome.v1'] as any).finished).toBe(true);
    });
});
