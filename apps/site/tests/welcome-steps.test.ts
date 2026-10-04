/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://lingogram.ai/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan"}
 */

// The setup steps on /welcome/ (src/welcome/steps.ts) wired to the REAL worker
// side (packages/shared/src/welcome/bridge.ts): the page's messages go through
// handleWelcomeMessage exactly as Chrome would deliver them, so the two ends of
// the protocol cannot drift apart without a test going red.

const store: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const handoffs: any[] = [];
let authStatus: { signedIn: boolean; email?: string } = { signedIn: false };
let extensionAnswers = true;
let extensionRefuses = false;
let edition: 'youtube' | 'rezka' = 'youtube';
let gtImport = false;
let refuseBegin = false;
const importAsks: unknown[] = [];
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
        session: {
            get: jest.fn(async () => ({ ...session })),
            set: jest.fn(async (items: Record<string, unknown>) => Object.assign(session, items)),
        },
        onChanged: { addListener: jest.fn() },
    },
    runtime: {
        id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
        lastError: undefined,
        getManifest: () => ({ version: '1.0.0' }),
        // From the page: (extensionId, message, callback).
        sendMessage: jest.fn((id: string, message: any, cb?: (r: unknown) => void) => {
            if (!extensionAnswers) return undefined; // never calls back: no extension
            if (message?.type === 'lingogram-extension-auth') {
                // The existing handoff check: the nonce must be the one the
                // extension issued through beginSignIn.
                handoffs.push(message.payload);
                const ok = message.payload.nonce === session['auth.pendingNonce'];
                if (ok) authStatus = { signedIn: true, email: message.payload.email };
                cb?.(ok ? { ok: true } : { ok: false, error: 'invalid or expired auth challenge' });
                return undefined;
            }
            if (extensionRefuses) {
                cb?.({ ok: false, error: 'unauthorized origin' });
                return undefined;
            }
            if (message?.op === 'beginSignIn' && refuseBegin) {
                cb?.({ ok: false, error: 'no' });
                return undefined;
            }
            if (message?.op === 'openGtImport') {
                importAsks.push(message);
                cb?.({ ok: true });
                return undefined;
            }
            const opts = edition === 'rezka' ? { edition, languages: ['en', 'ru', 'uk'] } : { edition };
            void bridge.handleWelcomeMessage(message, opts).then((r: any) => cb?.(message?.op === 'state' && gtImport ? { ...r, gtImport: true } : r));
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
import { extensionIdFrom, initSteps, languageLabel, localeTarget, pageFor, popularTiles } from '../src/welcome/steps';
import EN from '../src/data/i18n/en.json';

const en = EN as any;
const AUTH = {
    emailLabel: en.auth.register.emailLabel,
    passwordLabel: en.auth.register.passwordLabel,
    registerPasswordPlaceholder: en.auth.register.passwordPlaceholder,
    registerSubmit: en.auth.register.submit,
    registerBusy: en.auth.register.submitBusy,
    registerAltPrefix: en.auth.register.altPrefix,
    registerAltLink: en.auth.register.altLink,
    loginSubmit: en.auth.login.submit,
    loginBusy: en.auth.login.submitBusy,
    loginAltPrefix: en.auth.login.altPrefix,
    loginAltLink: en.auth.login.altLink,
};
const T = en.welcome.steps;
const VIDEOS = { en: { id: 'Kk1vR7BdTno', title: 'Cosmic Dawn (Official NASA Trailer)' } };
const EXT_URL = '/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan';

// The site's Firebase sign-up / log-in, faked at the seam steps.ts reads.
const deps = {
    register: jest.fn(async (email: string) => ({ uid: 'u1', email, idToken: 'id-token' })),
    login: jest.fn(async (email: string) => ({ uid: 'u1', email, idToken: 'id-token' })),
    google: jest.fn(async () => ({ uid: 'g1', email: 'g@b.c', idToken: 'g-token' })),
    extensionToken: jest.fn(async () => 'custom-token'),
};
(window as any).__WS_DEPS__ = deps;

const went: string[] = [];
(window as any).__WS_NAVIGATE__ = (u: string) => went.push(u);

const flush = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

const ws = () => document.getElementById('ws')!;
const btn = (text: string) => Array.from(ws().querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent === text)!;
const current = () => ws().querySelector('.ws-step[aria-current="step"] .ws-step-label')!.textContent;
const tile = (code: string) => ws().querySelector<HTMLButtonElement>(`.ws-tile[data-code="${code}"]`)!;
const tileCodes = () => Array.from(ws().querySelectorAll<HTMLElement>('.ws-tile')).map((t) => t.dataset.code);
const pressed = () => Array.from(ws().querySelectorAll<HTMLElement>('.ws-tile[aria-pressed="true"]')).map((t) => t.dataset.code);
const setNative = (code: string) => {
    const n = ws().querySelector<HTMLSelectElement>('.ws-native')!;
    n.value = code;
    n.dispatchEvent(new Event('change'));
};
const setBrowserLanguage = (lang: string) => Object.defineProperty(window.navigator, 'languages', { value: [lang], configurable: true });

async function mount(opts: { lang?: string; locales?: string[]; search?: string } = {}): Promise<boolean> {
    history.replaceState(null, '', opts.search ?? EXT_URL);
    document.body.innerHTML = '<div class="ws" id="ws" hidden></div><main class="wl"><h1>Thanks for installing</h1></main>';
    (window as any).__WELCOME_STEPS = {
        lang: opts.lang ?? 'en',
        locales: opts.locales ?? [],
        videos: VIDEOS,
        i18n: T,
        auth: AUTH,
    };
    const shown = await initSteps(document, window);
    await flush();
    return shown;
}

async function fillAndSubmit(email: string, password: string): Promise<void> {
    btn(T.emailLink).click();
    await flush();
    const [e, p] = Array.from(ws().querySelectorAll<HTMLInputElement>('.ws-input'));
    e.value = email;
    p.value = password;
    ws().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
}

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    authStatus = { signedIn: false };
    extensionAnswers = true;
    extensionRefuses = false;
    edition = 'youtube';
    gtImport = false;
    refuseBegin = false;
    importAsks.length = 0;
    signIns.length = 0;
    handoffs.length = 0;
    went.length = 0;
    for (const k of Object.keys(session)) delete session[k];
    Object.values(deps).forEach((f) => f.mockClear());
    try {
        sessionStorage.clear();
    } catch {
        // none in this environment.
    }
    setBrowserLanguage('en-US');
});

describe('before there is an extension', () => {
    test('no answer from the extension: the steps still show, nothing is switchable', async () => {
        extensionAnswers = false;
        jest.useFakeTimers();
        history.replaceState(null, '', EXT_URL);
        document.body.innerHTML = '<div class="ws" id="ws" hidden></div><main class="wl"></main>';
        (window as any).__WELCOME_STEPS = { lang: 'en', locales: [], videos: VIDEOS, i18n: T, auth: AUTH };
        const p = initSteps(document, window);
        jest.advanceTimersByTime(2000);
        jest.useRealTimers();
        expect(await p).toBe(true);
        expect(ws().hidden).toBe(false);
        expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(true);
        expect(current()).toBe('Language');
        // The language list is the page's own.
        expect(ws().querySelector('.ws-native')!.querySelectorAll('option').length).toBeGreaterThan(10);
    });

    test('the extension refuses (not lingogram.ai, an old build): the steps show without it', async () => {
        extensionRefuses = true;
        expect(await mount()).toBe(true);
        setNative('ru');
        tile('es').click();
        await flush();
        btn('Continue').click();
        await flush();
        // Nothing was written anywhere: there is no extension to write to.
        expect(store['lang.v1']).toBeUndefined();
        expect(current()).toBe('Account');
        // The account can still be made here; there is just no extension to hand it to.
        await fillAndSubmit('new@b.c', 'longpassword');
        expect(deps.register).toHaveBeenCalledWith('new@b.c', 'longpassword');
        expect(deps.extensionToken).not.toHaveBeenCalled();
        // Signed in on the site: straight on to the last step, which says what is missing.
        expect(current()).toBe('Start');
        expect((ws().querySelector('.ws-switch') as HTMLInputElement).disabled).toBe(true);
        expect(ws().querySelector('.ws-note')!.textContent).toContain(T.needsExtension);
        expect((btn('Add to Chrome') as HTMLAnchorElement).href).toBe(
            'https://chromewebstore.google.com/detail/pkoibjilnaeadmcnmfkgcjhalljbmfan',
        );
    });

    test('the id must look like a Chrome extension id', () => {
        expect(extensionIdFrom('?id=pkoibjilnaeadmcnmfkgcjhalljbmfan')).toBe('pkoibjilnaeadmcnmfkgcjhalljbmfan');
        expect(extensionIdFrom('?id=../../evil')).toBeNull();
        expect(extensionIdFrom('?ext=youtube')).toBeNull();
    });
});

describe('Language', () => {
    test('the extension answers: the steps replace the ordinary page, with no required/optional labels', async () => {
        expect(await mount()).toBe(true);
        expect(ws().hidden).toBe(false);
        expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(true);
        expect(Array.from(ws().querySelectorAll('.ws-step-label')).map((n) => n.textContent)).toEqual(['Language', 'Account', 'Start']);
        expect(Array.from(ws().querySelectorAll('.ws-step-status')).map((n) => n.textContent)).toEqual(['', '', '']);
        expect(current()).toBe('Language');
    });

    test('the popular languages are tiles with a flag; the native language is never one (English apart)', async () => {
        await mount({ lang: 'ru', locales: ['en', 'ru'] });
        expect(tileCodes()).toEqual(['en', 'es', 'de', 'ja', 'fr', 'ko', 'zh', 'it']);
        expect(ws().querySelectorAll('.ws-tile .ws-flag svg')).toHaveLength(8);
        // The page is Russian, so Russian is the native language and English the default pick.
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('ru');
        expect(pressed()).toEqual(['en']);
        // A name in the page's language, not the code.
        expect(tile('es').textContent).toBe('Испанский');
        // Everything else is one list away.
        const other = ws().querySelector<HTMLSelectElement>('.ws-other')!;
        expect(Array.from(other.options).some((o) => o.value === 'nl')).toBe(true);
        expect(Array.from(other.options).some((o) => o.value === 'es')).toBe(false);
    });

    test('an English speaker still sees English first, and nothing is pre-picked', async () => {
        await mount();
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('en');
        expect(tileCodes()).toEqual(['en', 'es', 'de', 'ja', 'fr', 'ko', 'zh', 'it']);
        expect(pressed()).toEqual([]);
        expect(btn('Continue').hasAttribute('disabled')).toBe(true);
        tile('de').click();
        await flush();
        expect(pressed()).toEqual(['de']);
        expect(btn('Continue').hasAttribute('disabled')).toBe(false);
        // English is a choice like any other, even for a native English speaker.
        tile('en').click();
        await flush();
        expect(pressed()).toEqual(['en']);
        expect(btn('Continue').hasAttribute('disabled')).toBe(false);
    });

    test('saved languages are shown as saved, even English for an English speaker', async () => {
        store['lang.v1'] = { learning: 'en', native: 'en' };
        await mount();
        ws().querySelectorAll<HTMLElement>('.ws-step')[0].click();
        await flush();
        expect(pressed()).toEqual(['en']);
        expect(btn('Continue').hasAttribute('disabled')).toBe(false);
    });

    test('a language outside the tiles is picked from the list and saved', async () => {
        await mount();
        const other = ws().querySelector<HTMLSelectElement>('.ws-other')!;
        other.value = 'nl';
        other.dispatchEvent(new Event('change'));
        await flush();
        expect(pressed()).toEqual([]);
        expect(ws().querySelector<HTMLSelectElement>('.ws-other')!.value).toBe('nl');
        btn('Continue').click();
        await flush();
        expect(store['lang.v1']).toEqual({ learning: 'nl', native: 'en' });
        expect(current()).toBe('Account');
    });

    test('picking the language being learned as the native one clears the learning pick', async () => {
        await mount({ lang: 'ru', locales: [] });
        expect(pressed()).toEqual(['en']);
        setNative('en');
        await flush();
        expect(pressed()).toEqual([]);
        expect(tileCodes()[0]).toBe('en');
        // Nothing is chosen any more, so there is nothing to continue with.
        expect(btn('Continue').hasAttribute('disabled')).toBe(true);
    });

    test('the native language is the page language: choosing one moves to its page, keeping the pick', async () => {
        await mount({ lang: 'en', locales: ['en', 'de', 'ru'] });
        tile('es').click();
        await flush();
        setNative('de');
        expect(went).toHaveLength(1);
        expect(went[0]).toBe('/de/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan&hl=1');
        // The page that opens next is that language, and remembers the pick.
        await mount({ lang: 'de', locales: ['en', 'de', 'ru'], search: went[0] });
        expect(pressed()).toEqual(['es']);
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('de');
    });

    test('a returning visitor who changes the native language gets that language, not the saved one', async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: false, finished: false };
        // The visitor was on /ru/, chose Spanish as native and moved on with Italian picked.
        sessionStorage.setItem('ws.learning', 'it');
        await mount({ lang: 'es', locales: ['en', 'es', 'ru'], search: '/es/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan&hl=1' });
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('es');
        expect(pressed()).toEqual(['it']);
    });

    test('without a deliberate choice the saved languages lead', async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        await mount({ lang: 'es', locales: ['en', 'es', 'ru'] });
        // Step is Account (languages saved); go back to Language to see them.
        ws().querySelectorAll<HTMLElement>('.ws-step')[0].click();
        await flush();
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('ru');
        expect(pressed()).toEqual(['en']);
    });

    test('a native language without its own page changes the choice only', async () => {
        await mount({ lang: 'en', locales: ['en'] });
        setNative('ru');
        await flush();
        expect(went).toEqual([]);
        expect((ws().querySelector('.ws-native') as HTMLSelectElement).value).toBe('ru');
    });

    test('HDrezka offers its three languages', async () => {
        edition = 'rezka';
        await mount({ lang: 'ru', locales: [] });
        expect(tileCodes()).toEqual(['en', 'uk']);
        expect(ws().querySelector('.ws-other')).toBeNull();
    });
});

describe('the page speaks the visitor language', () => {
    test('the root page moves to the browser language when that language has a page', async () => {
        setBrowserLanguage('de-DE');
        await mount({ lang: 'en', locales: ['en', 'de'] });
        expect(went).toEqual(['/de/welcome/' + EXT_URL.slice(EXT_URL.indexOf('?'))]);
    });

    test('a native language saved in the extension wins over the browser language', async () => {
        store['lang.v1'] = { learning: 'en', native: 'fr' };
        setBrowserLanguage('de-DE');
        await mount({ lang: 'en', locales: ['en', 'de', 'fr'] });
        expect(went[0]).toMatch(/^\/fr\/welcome\//);
    });

    test('localeTarget: only the root page moves, never one reached by choice', () => {
        const base = { lang: 'en', locales: ['en', 'de', 'fil', 'no'], want: 'de', search: '?id=x' };
        expect(localeTarget(base)).toBe('/de/welcome/?id=x');
        expect(localeTarget({ ...base, search: '?id=x&hl=1' })).toBeNull();
        expect(localeTarget({ ...base, lang: 'ru' })).toBeNull();
        expect(localeTarget({ ...base, want: 'xx' })).toBeNull();
        expect(localeTarget({ ...base, want: 'en' })).toBeNull();
        expect(localeTarget({ ...base, want: 'nb' })).toBe('/no/welcome/?id=x');
        expect(localeTarget({ ...base, want: 'tl' })).toBe('/fil/welcome/?id=x');
    });

    test('pageFor marks the choice so the page it opens stays put', () => {
        expect(pageFor('en', '?id=x')).toBe('/welcome/?id=x&hl=1');
        expect(pageFor('ru', '')).toBe('/ru/welcome/?hl=1');
    });

    test('popularTiles: eight at most, the native language never among them', () => {
        const all = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'uk', 'nl'];
        expect(popularTiles(all, 'ru')).toEqual(['en', 'es', 'de', 'ja', 'fr', 'ko', 'zh', 'it']);
        expect(popularTiles(all, 'en')).toEqual(['en', 'es', 'de', 'ja', 'fr', 'ko', 'zh', 'it']);
        expect(popularTiles(all, 'es')).toEqual(['en', 'de', 'ja', 'fr', 'ko', 'zh', 'it', 'pt']);
        expect(popularTiles(['en', 'ru', 'uk'], 'ru')).toEqual(['en', 'uk']);
        expect(popularTiles(['de', 'fr'], 'fr')).toEqual(['de']); // English not offered: nothing to put first
    });
});

describe('Account', () => {
    test('Language → saved in the extension; Account: skip is remembered there', async () => {
        await mount();
        tile('es').click();
        await flush();
        btn('Continue').click();
        await flush();
        expect(store['lang.v1']).toEqual({ learning: 'es', native: 'en' });
        expect(current()).toBe('Account');
        btn('Skip for now').click();
        await flush();
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: false });
        expect(current()).toBe('Start');
        expect(ws().querySelectorAll('.ws-step-status')[1].textContent).toBe('Skipped');
    });

    test('Google is the way in; the email form is one link away', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        expect(current()).toBe('Account');
        expect(ws().querySelector('.ws-works')!.textContent).toBe(T.accountHint);
        expect(btn('Continue with Google').classList.contains('ws-primary')).toBe(true);
        expect(btn('Skip for now').classList.contains('ws-secondary')).toBe(true);
        expect(ws().querySelector('.ws-input')).toBeNull();
        btn(T.emailLink).click();
        await flush();
        expect(ws().querySelectorAll('.ws-input')).toHaveLength(2);
        expect(btn(AUTH.registerSubmit).textContent).toBe('Create account');
    });

    test('Google sign-in is handed to the extension and goes straight on to the last step', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        btn('Continue with Google').click();
        await flush();
        expect(deps.google).toHaveBeenCalled();
        expect(handoffs).toEqual([{ customToken: 'custom-token', uid: 'g1', email: 'g@b.c', nonce: session['auth.pendingNonce'] }]);
        expect(current()).toBe('Start');
        expect(ws().querySelector('.ws-progress-text')!.textContent).toBe('2 of 3 done');
    });

    test('the account is made on the site and handed to the extension; the page moves on by itself', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        await fillAndSubmit('a@b.c', 'longpassword');
        expect(deps.register).toHaveBeenCalledWith('a@b.c', 'longpassword');
        expect(deps.extensionToken).toHaveBeenCalledWith('id-token');
        // The handoff carried the nonce the extension issued just before it.
        expect(handoffs).toEqual([{ customToken: 'custom-token', uid: 'u1', email: 'a@b.c', nonce: session['auth.pendingNonce'] }]);
        expect(current()).toBe('Start');
        expect(ws().querySelector('.ws-progress-text')!.textContent).toBe('2 of 3 done');
    });

    test('the form switches to log-in for an existing account', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        btn(T.emailLink).click();
        await flush();
        btn(AUTH.registerAltLink).click();
        await flush();
        expect(btn(AUTH.loginSubmit)).toBeDefined();
        const [e, p] = Array.from(ws().querySelectorAll<HTMLInputElement>('.ws-input'));
        e.value = 'a@b.c';
        p.value = 'pw';
        ws().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
        expect(deps.login).toHaveBeenCalledWith('a@b.c', 'pw');
        expect(deps.register).not.toHaveBeenCalled();
        expect(handoffs).toHaveLength(1);
    });

    test('a sign-up error is shown on the form, and nothing is handed over', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        deps.register.mockRejectedValueOnce(new Error('An account with this email already exists. Try logging in.'));
        await fillAndSubmit('a@b.c', 'longpassword');
        expect(ws().querySelector('.ws-error')!.textContent).toBe('An account with this email already exists. Try logging in.');
        expect(handoffs).toHaveLength(0);
        expect(current()).toBe('Account');
    });

    test('the account is made but the extension token fails: the error stays, with a retry, and the page does not move on', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        deps.extensionToken.mockRejectedValueOnce(new Error('Could not connect the extension (500).'));
        await fillAndSubmit('a@b.c', 'longpassword');
        expect(handoffs).toHaveLength(0);
        expect(current()).toBe('Account');
        expect(ws().querySelector('.ws-error')!.textContent).toBe('Could not connect the extension (500).');
        btn(T.retryConnect).click();
        await flush();
        expect(handoffs).toHaveLength(1);
        expect(current()).toBe('Start');
    });

    test('looking at the tab again does not wipe what is being typed', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        btn(T.emailLink).click();
        await flush();
        const email = ws().querySelector<HTMLInputElement>('.ws-input')!;
        email.value = 'half@typed';
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        // Nothing changed in the extension, so the same field is still there, still filled.
        expect(ws().querySelector<HTMLInputElement>('.ws-input')).toBe(email);
        expect(email.value).toBe('half@typed');
    });

    test('while Google sign-in is open, coming back to the tab does not offer a second one', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        let finish!: (u: { uid: string; email: string; idToken: string }) => void;
        deps.google.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        const google = btn('Continue with Google') as HTMLButtonElement;
        google.click();
        await flush();
        authStatus = { signedIn: true, email: 'other@b.c' };
        window.dispatchEvent(new Event('focus'));
        await flush();
        expect(btn('Continue with Google')).toBe(google);
        expect((btn('Continue with Google') as HTMLButtonElement).disabled).toBe(true);
        finish({ uid: 'g1', email: 'g@b.c', idToken: 't' });
        await flush();
        expect(deps.google).toHaveBeenCalledTimes(1);
    });

    test('the extension refuses to start the sign-in: that is said, with a retry, not a bare "signed in"', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        refuseBegin = true;
        await mount();
        btn('Continue with Google').click();
        await flush();
        expect(handoffs).toHaveLength(0);
        expect(current()).toBe('Account');
        expect(ws().querySelector('.ws-error')!.textContent).toBe('Could not connect the extension.');
        refuseBegin = false;
        btn(T.retryConnect).click();
        await flush();
        expect(handoffs).toHaveLength(1);
        expect(current()).toBe('Start');
    });

    test('a visitor who has moved to another step is not pulled back to Start by a late sign-in', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        let finish!: (u: { uid: string; email: string; idToken: string }) => void;
        deps.google.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        btn('Continue with Google').click();
        await flush();
        ws().querySelectorAll<HTMLElement>('.ws-step')[0].click(); // back to Language meanwhile
        await flush();
        finish({ uid: 'g1', email: 'g@b.c', idToken: 't' });
        await flush();
        expect(current()).toBe('Language');
    });

    test('a sign-in finished in the other tab shows when this tab is looked at again', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        expect(current()).toBe('Account');
        authStatus = { signedIn: true, email: 'a@b.c' };
        window.dispatchEvent(new Event('focus'));
        await flush();
        expect(ws().querySelector('.ws-ok')!.textContent).toBe('Signed in as a@b.c on lingogram.ai and in the extension');
        expect(ws().querySelector('.ws-progress-text')!.textContent).toBe('2 of 3 done');
    });
});

describe('Start', () => {
    const start = async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(current()).toBe('Start');
    };

    test('opens a checked video for the language being learned, and remembers that setup is finished', async () => {
        await start();
        expect(ws().querySelector('.ws-video .ws-row-title')!.textContent).toBe('Cosmic Dawn (Official NASA Trailer)');
        btn('Watch the first video').click();
        await flush();
        expect(went).toEqual(['https://www.youtube.com/watch?v=Kk1vR7BdTno']);
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: true });
    });

    test('a language with no checked video goes to YouTube, with no card', async () => {
        store['lang.v1'] = { learning: 'ja', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(ws().querySelector('.ws-video')).toBeNull();
        btn(T.finishYoutube).click();
        await flush();
        expect(went).toEqual(['https://www.youtube.com/']);
    });

    test('with no extension there is no video to open: the button just finishes', async () => {
        extensionRefuses = true;
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        await mount({ lang: 'ru', locales: [] });
        ws().querySelectorAll<HTMLElement>('.ws-step')[2].click();
        await flush();
        expect(ws().querySelector('.ws-video')).toBeNull();
        btn(T.finish).click();
        await flush();
        expect(went).toEqual([]);
        expect(ws().hidden).toBe(true);
    });

    test('word highlighting is one switch that writes the extension prefs; the video sites have none', async () => {
        await start();
        expect(Array.from(ws().querySelectorAll('.ws-row-title')).map((n) => n.textContent)).toEqual([
            'Cosmic Dawn (Official NASA Trailer)',
            'Highlight my words on websites',
        ]);
        const sw = ws().querySelectorAll<HTMLInputElement>('.ws-switch');
        expect(sw).toHaveLength(1);
        sw[0].checked = true;
        sw[0].dispatchEvent(new Event('change'));
        await flush();
        expect((store['prefs.v1'] as any).pageHighlight).toBe(true);
    });

    test('the Google Translate import row appears only where the extension can do it, and asks it to', async () => {
        await start();
        expect(ws().querySelector('.ws-row .ws-add')).toBeNull();
        gtImport = true;
        await mount({ lang: 'ru', locales: [] });
        btn('Import').click();
        await flush();
        expect(importAsks).toEqual([{ type: 'lingogram-welcome', op: 'openGtImport' }]);
    });

    test('HDrezka: no video card; the button goes back to the ordinary welcome content', async () => {
        edition = 'rezka';
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(ws().querySelector('.ws-video')).toBeNull();
        expect(ws().querySelector('.ws-lead')!.textContent).toBe(T.startLeadRezka);
        btn(T.finish).click();
        await flush();
        expect(ws().hidden).toBe(true);
        expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(false);
        expect(went).toEqual([]);
    });
});

test('language names read in the page language, with the own name beside', () => {
    expect(languageLabel('ru', 'Русский', 'Russian', 'en')).toBe('Russian — Русский');
    expect(languageLabel('en', 'English', 'English', 'en')).toBe('English');
});
