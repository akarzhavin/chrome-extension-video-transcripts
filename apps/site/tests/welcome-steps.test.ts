/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://lingogram.ai/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan"}
 */

// The setup steps on /welcome/ (src/welcome/steps.ts) wired to the REAL worker
// side (packages/shared/src/welcome/bridge.ts): the page's messages go through
// handleWelcomeMessage exactly as Chrome would deliver them, so the two ends of
// the protocol cannot drift apart without a test going red.

const store: Record<string, unknown> = {};
let authStatus: { signedIn: boolean; email?: string } = { signedIn: false };
let extensionAnswers = true;
let extensionRefuses = false;
const signIns: unknown[] = [];

(global as any).__WS_NO_AUTO__ = true;
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
                for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v));
            }),
        },
        onChanged: { addListener: jest.fn() },
    },
    runtime: {
        id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
        lastError: undefined,
        getManifest: () => ({ version: '1.0.0' }),
        // From the page: (extensionId, message, callback). From the bridge's
        // own sibling ping: (extensionId, message) → promise.
        sendMessage: jest.fn((id: string, message: any, cb?: (r: unknown) => void) => {
            if (message?.type === 'lingogram-sibling') return Promise.reject(new Error('absent'));
            if (!extensionAnswers) return undefined; // never calls back: no extension
            if (extensionRefuses) {
                cb?.({ ok: false, error: 'unauthorized origin' });
                return undefined;
            }
            void bridge.handleWelcomeMessage(message, { edition: 'youtube' }).then((r) => cb?.(r));
            return undefined;
        }),
    },
    i18n: { getMessage: () => '' },
};

jest.mock('../../../packages/shared/src/auth/background', () => ({
    handleAuthMessage: async (m: { action: string; from?: string }) => {
        if (m.action === 'AUTH_STATUS') return authStatus;
        signIns.push(m);
        return { ok: true };
    },
    isAllowedExternalSender: () => true,
}));

import * as bridge from '../../../packages/shared/src/welcome/bridge';
import { extensionIdFrom, initSteps, languageLabel } from '../src/welcome/steps';
import EN from '../src/data/i18n/en.json';

const flush = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(): Promise<boolean> {
    document.body.innerHTML = '<div class="ws" id="ws" hidden></div><main class="wl"><h1>Thanks for installing</h1></main>';
    (window as any).__WELCOME_STEPS = { lang: 'en', i18n: (EN as any).welcome.steps };
    const shown = await initSteps(document, window);
    await flush();
    return shown;
}

const ws = () => document.getElementById('ws')!;
const btn = (text: string) => Array.from(ws().querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent === text)!;
const current = () => ws().querySelector('.ws-step[aria-current="step"] .ws-step-label')!.textContent;

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    authStatus = { signedIn: false };
    extensionAnswers = true;
    extensionRefuses = false;
    signIns.length = 0;
});

test('no answer from the extension: the steps still show, nothing is switchable', async () => {
    extensionAnswers = false;
    jest.useFakeTimers();
    document.body.innerHTML = '<div class="ws" id="ws" hidden></div><main class="wl"></main>';
    (window as any).__WELCOME_STEPS = { lang: 'en', i18n: (EN as any).welcome.steps };
    const p = initSteps(document, window);
    jest.advanceTimersByTime(2000);
    jest.useRealTimers();
    expect(await p).toBe(true);
    expect(ws().hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(true);
    expect(current()).toBe('Language');
    // The language list is the page's own.
    expect(ws().querySelectorAll('select')[0].querySelectorAll('option').length).toBeGreaterThan(10);
});

test('the extension refuses (not lingogram.ai, an old build): the steps show without it', async () => {
    extensionRefuses = true;
    expect(await mount()).toBe(true);
    btn('Continue');
    const [learning, native] = Array.from(ws().querySelectorAll('select'));
    learning.value = 'en';
    native.value = 'ru';
    native.dispatchEvent(new Event('change'));
    btn('Continue').click();
    await flush();
    // Nothing was written anywhere: there is no extension to write to.
    expect(store['lang.v1']).toBeUndefined();
    expect(current()).toBe('Account');
    // Sign-in is the site's own page, in a new tab.
    const signIn = btn('Sign in or create an account') as HTMLAnchorElement;
    expect(signIn.tagName).toBe('A');
    expect(new URL(signIn.href).pathname).toBe('/login/');
    btn('Skip for now').click();
    await flush();
    expect(current()).toBe('Settings');
    expect(Array.from(ws().querySelectorAll<HTMLInputElement>('.ws-switch')).every((x) => x.disabled)).toBe(true);
    expect(ws().querySelector('.ws-note')!.textContent).toContain((EN as any).welcome.steps.needsExtension);
    expect((btn('Add to Chrome') as HTMLAnchorElement).href).toBe(
        'https://chromewebstore.google.com/detail/pkoibjilnaeadmcnmfkgcjhalljbmfan',
    );
});

test('the id must look like a Chrome extension id', () => {
    expect(extensionIdFrom('?id=pkoibjilnaeadmcnmfkgcjhalljbmfan')).toBe('pkoibjilnaeadmcnmfkgcjhalljbmfan');
    expect(extensionIdFrom('?id=../../evil')).toBeNull();
    expect(extensionIdFrom('?ext=youtube')).toBeNull();
});

test('the extension answers: the steps replace the ordinary page, starting at Language', async () => {
    expect(await mount()).toBe(true);
    expect(ws().hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(true);
    expect(Array.from(ws().querySelectorAll('.ws-step-label')).map((n) => n.textContent)).toEqual(['Language', 'Account', 'Settings']);
    expect(current()).toBe('Language');
});

test('Language → saved in the extension; Account: skip is remembered there', async () => {
    await mount();
    const [learning, native] = Array.from(ws().querySelectorAll('select'));
    learning.value = 'en';
    native.value = 'ru';
    native.dispatchEvent(new Event('change'));
    btn('Continue').click();
    await flush();
    expect(store['lang.v1']).toEqual({ learning: 'en', native: 'ru' });
    expect(current()).toBe('Account');
    btn('Sign in or create an account').click();
    await flush();
    expect(signIns).toEqual([{ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'welcome' }]);
    btn('Skip for now').click();
    await flush();
    expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: false });
    expect(current()).toBe('Settings');
    expect(ws().querySelectorAll('.ws-step-status')[1].textContent).toBe('Skipped');
});

test('a sign-in finished in the other tab shows when this tab is looked at again', async () => {
    store['lang.v1'] = { learning: 'en', native: 'ru' };
    await mount();
    expect(current()).toBe('Account');
    authStatus = { signedIn: true, email: 'a@b.c' };
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(ws().querySelector('.ws-ok')!.textContent).toBe('Signed in as a@b.c on lingogram.ai and in the extension');
    expect(ws().querySelector('.ws-progress-text')!.textContent).toBe('2 of 3 done');
});

test('Settings: switches write the extension prefs; the other edition links to the store', async () => {
    store['lang.v1'] = { learning: 'en', native: 'ru' };
    store['welcome.v1'] = { skippedAccount: true, finished: false };
    await mount();
    expect(current()).toBe('Settings');
    expect(Array.from(ws().querySelectorAll('.ws-row-title')).map((n) => n.textContent)).toEqual([
        'YouTube',
        'Netflix',
        'HDrezka',
        'Highlight my words on websites',
    ]);
    const netflix = ws().querySelectorAll<HTMLInputElement>('.ws-switch')[1];
    netflix.checked = false;
    netflix.dispatchEvent(new Event('change'));
    await flush();
    expect((store['prefs.v1'] as any).siteNetflix).toBe(false);
    expect((btn('Add to Chrome') as HTMLAnchorElement).href).toBe(
        'https://chromewebstore.google.com/detail/hmdkmkimdbomemfcjmgeclchbcdbhabj',
    );
});

test('language names read in the page language, with the own name beside', () => {
    expect(languageLabel('ru', 'Русский', 'Russian', 'en')).toBe('Russian — Русский');
    expect(languageLabel('en', 'English', 'English', 'en')).toBe('English');
});
