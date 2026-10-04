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
import { extensionIdFrom, initSteps, languageLabel, localeTarget, nativeTiles, pageFor, popularTiles } from '../src/welcome/steps';
import EN from '../src/data/i18n/en.json';

const en = EN as any;
const AUTH = {
    emailLabel: en.auth.register.emailLabel,
    passwordLabel: en.auth.register.passwordLabel,
    registerPasswordPlaceholder: en.auth.register.passwordPlaceholder,
    registerSubmit: en.auth.register.submit,
    registerBusy: en.auth.register.submitBusy,
    registerGoogle: en.auth.register.googleCta,
    loginSubmit: en.auth.login.submit,
    loginBusy: en.auth.login.submitBusy,
    loginGoogle: en.auth.login.googleCta,
};
const T = en.welcome.steps;
const VIDEOS = { en: { id: 'Kk1vR7BdTno', title: 'Cosmic Dawn (Official NASA Trailer)' } };
const EXT_URL = '/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan';
// Where a signed-in visitor is sent: the cabinet's introduction, with the
// extension id so it can talk to the extension. Written out, not built.
const CABINET = '/app/vocab/start?ext=pkoibjilnaeadmcnmfkgcjhalljbmfan&edition=youtube&from=welcome';

// The site's Firebase sign-up / log-in, faked at the seam steps.ts reads.
const deps = {
    register: jest.fn(async (email: string) => ({ uid: 'u1', email, idToken: 'id-token' })),
    login: jest.fn(async (email: string) => ({ uid: 'u1', email, idToken: 'id-token' })),
    google: jest.fn(async () => ({ uid: 'g1', email: 'g@b.c', idToken: 'g-token' })),
    extensionToken: jest.fn(async () => 'custom-token'),
    // The site's stored session from an earlier visit: none unless a test says so.
    session: jest.fn(async (): Promise<{ uid: string; email: string; idToken: string } | null> => null),
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
const tile = (code: string) => ws().querySelector<HTMLButtonElement>(`.ws-learn .ws-tile[data-code="${code}"]`)!;
const tileCodes = () => Array.from(ws().querySelectorAll<HTMLElement>('.ws-learn .ws-tile')).map((t) => t.dataset.code);
const pressed = () => Array.from(ws().querySelectorAll<HTMLElement>('.ws-learn .ws-tile[aria-pressed="true"]')).map((t) => t.dataset.code);
const nativeTile = (code: string) => ws().querySelector<HTMLButtonElement>(`.ws-native-field .ws-tile[data-code="${code}"]`);
const nativeCodes = () => Array.from(ws().querySelectorAll<HTMLElement>('.ws-native-field .ws-tile')).map((t) => t.dataset.code);
// The native language as shown: its pressed tile, else what the list holds.
const nativeValue = () =>
    ws().querySelector<HTMLElement>('.ws-native-field .ws-tile[aria-pressed="true"]')?.dataset.code ??
    ws().querySelector<HTMLSelectElement>('.ws-native')!.value;
// Picks the native language the way a visitor would: its tile, or the list.
const setNative = (code: string) => {
    const t = nativeTile(code);
    if (t) {
        t.click();
        return;
    }
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
    deps.session.mockImplementation(async () => null);
    localStorage.clear();
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
        // Signed in on the site, no extension to hand it to: not the cabinet
        // (it could not talk to the extension), the last step here. The
        // extension opened this page (its id is in the link) and did not
        // answer: it is installed and too old, so it is not offered again.
        expect(went).toEqual([]);
        expect(current()).toBe('Start');
        expect(ws().querySelector('.ws-title')!.textContent).toBe(T.updateTitle);
        expect(ws().querySelector('.ws-install .ws-row-title')!.textContent).toBe(T.updateLead);
        expect(btn('Add to Chrome')).toBeUndefined();
        expect(ws().querySelector('.ws-switch')).toBeNull();
        expect(ws().querySelector('.ws-go')).toBeNull();
    });

    test('opened by hand, with no extension link: it may or may not be installed, and both are said', async () => {
        await mount({ search: '/welcome/' });
        ws().querySelectorAll<HTMLElement>('.ws-step')[2].click();
        await flush();
        expect(ws().querySelector('.ws-title')!.textContent).toBe(T.connectTitle);
        expect(ws().querySelector('.ws-install .ws-row-title')!.textContent).toBe(T.connectLead);
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
        expect(ws().querySelectorAll('.ws-learn .ws-tile .ws-flag svg')).toHaveLength(8);
        // The page is Russian, so Russian is the native language and English the default pick.
        expect(nativeValue()).toBe('ru');
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
        expect(nativeValue()).toBe('en');
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
        expect(nativeValue()).toBe('de');
    });

    test('a returning visitor who changes the native language gets that language, not the saved one', async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: false, finished: false };
        // The visitor was on /ru/, chose Spanish as native and moved on with Italian picked.
        sessionStorage.setItem('ws.learning', 'it');
        await mount({ lang: 'es', locales: ['en', 'es', 'ru'], search: '/es/welcome/?ext=youtube&id=pkoibjilnaeadmcnmfkgcjhalljbmfan&hl=1' });
        expect(nativeValue()).toBe('es');
        expect(pressed()).toEqual(['it']);
    });

    test('without a deliberate choice the saved languages lead', async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        await mount({ lang: 'es', locales: ['en', 'es', 'ru'] });
        // Step is Account (languages saved); go back to Language to see them.
        ws().querySelectorAll<HTMLElement>('.ws-step')[0].click();
        await flush();
        expect(nativeValue()).toBe('ru');
        expect(pressed()).toEqual(['en']);
    });

    test('a native language without its own page changes the choice only', async () => {
        await mount({ lang: 'en', locales: ['en'] });
        setNative('ru');
        await flush();
        expect(went).toEqual([]);
        expect(nativeValue()).toBe('ru');
    });

    test('HDrezka offers its three languages', async () => {
        edition = 'rezka';
        await mount({ lang: 'ru', locales: [] });
        expect(tileCodes()).toEqual(['en', 'uk']);
        expect(ws().querySelector('.ws-other')).toBeNull();
    });
});

describe('native language tiles', () => {
    test('the native languages this site sees most, each named in its own language, with a flag', async () => {
        await mount({ lang: 'ru', locales: [] });
        expect(nativeCodes()).toEqual(['ru', 'zh', 'es', 'en', 'pt', 'vi', 'ko', 'ja']);
        const names = Array.from(ws().querySelectorAll('.ws-native-field .ws-tile-name')).map((n) => n.textContent);
        expect(names.slice(0, 3)).toEqual(['Русский', '中文', 'Español']);
        expect(ws().querySelector('.ws-native-field .ws-tile[data-code="vi"] .ws-flag svg')).not.toBeNull();
        // The page is Russian: Russian is pressed, the list holds nothing.
        expect(nativeValue()).toBe('ru');
        expect(ws().querySelector<HTMLSelectElement>('.ws-native')!.value).toBe('');
    });

    test('a native language outside the tiles comes first, pressed', async () => {
        await mount({ lang: 'de', locales: [] });
        expect(nativeCodes()[0]).toBe('de');
        expect(nativeCodes()).toHaveLength(8);
        expect(nativeTile('de')!.getAttribute('aria-pressed')).toBe('true');
    });

    test('the tiles are the offered languages only, and the list holds the rest', () => {
        expect(nativeTiles(['en', 'ru', 'uk'], 'ru')).toEqual(['ru', 'en', 'uk']);
        expect(nativeTiles(['en', 'ru', 'de'], 'de')).toEqual(['de', 'ru', 'en']);
        expect(nativeTiles(['en', 'ru'], '')).toEqual(['ru', 'en']);
        expect(nativeTiles(['en', 'ru'], 'xx')).toEqual(['ru', 'en']);
    });

    test('a native language from the list is saved like a tile', async () => {
        await mount({ lang: 'en', locales: [] });
        setNative('de');
        await flush();
        expect(nativeValue()).toBe('de');
        expect(nativeCodes()[0]).toBe('de');
        tile('es').click();
        await flush();
        btn('Continue').click();
        await flush();
        expect(store['lang.v1']).toEqual({ learning: 'es', native: 'de' });
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

    test('Create account / Log in tabs over one form, Google first, skip in the closing line', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        expect(current()).toBe('Account');
        const tabs = Array.from(ws().querySelectorAll<HTMLElement>('.ws-mode'));
        expect(tabs.map((x) => x.textContent)).toEqual(['Create account', 'Log in']);
        expect(tabs.map((x) => x.getAttribute('aria-selected'))).toEqual(['true', 'false']);
        // Google comes first, with its mark, then the email form, open from the start.
        const google = ws().querySelector<HTMLElement>('.ws-google')!;
        expect(google.textContent).toBe(AUTH.registerGoogle);
        expect(google.querySelector('.ws-gmark svg')).not.toBeNull();
        expect(ws().querySelector('.ws-or')!.textContent).toBe(T.orEmail);
        expect(ws().querySelectorAll('.ws-input')).toHaveLength(2);
        expect(ws().querySelector('form button[type=submit]')!.textContent).toBe(AUTH.registerSubmit);
        // Skipping sits in the line that says why it is safe.
        const foot = ws().querySelector('.ws-skip-line')!;
        expect(foot.textContent).toBe(`${T.accountHint} ${T.skip}`);
        // Log in: the same form, its own words.
        tabs[1].click();
        await flush();
        expect(ws().querySelector('.ws-google')!.textContent).toBe(AUTH.loginGoogle);
        expect(Array.from(ws().querySelectorAll<HTMLElement>('.ws-mode')).map((x) => x.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        expect(ws().querySelector<HTMLInputElement>('input[type=password]')!.autocomplete).toBe('current-password');
    });

    test('Google sign-in is handed to the extension and goes straight on to the cabinet', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        btn(AUTH.registerGoogle).click();
        await flush();
        expect(deps.google).toHaveBeenCalled();
        expect(handoffs).toEqual([{ customToken: 'custom-token', uid: 'g1', email: 'g@b.c', nonce: session['auth.pendingNonce'] }]);
        expect(went).toEqual([CABINET]);
    });

    test('the HDrezka edition is named in the cabinet link', async () => {
        edition = 'rezka';
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        await mount();
        btn(AUTH.registerGoogle).click();
        await flush();
        expect(went).toEqual(['/app/vocab/start?ext=pkoibjilnaeadmcnmfkgcjhalljbmfan&edition=rezka&from=welcome']);
    });

    test('the account is made on the site and handed to the extension; the page moves on by itself', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        await fillAndSubmit('a@b.c', 'longpassword');
        expect(deps.register).toHaveBeenCalledWith('a@b.c', 'longpassword');
        expect(deps.extensionToken).toHaveBeenCalledWith('id-token');
        // The handoff carried the nonce the extension issued just before it.
        expect(handoffs).toEqual([{ customToken: 'custom-token', uid: 'u1', email: 'a@b.c', nonce: session['auth.pendingNonce'] }]);
        expect(went).toEqual([CABINET]);
    });

    test('the form switches to log-in for an existing account', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        ws().querySelectorAll<HTMLElement>('.ws-mode')[1].click();
        await flush();
        expect(ws().querySelector('form button[type=submit]')!.textContent).toBe(AUTH.loginSubmit);
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
        expect(went).toEqual([]);
        btn(T.retryConnect).click();
        await flush();
        expect(handoffs).toHaveLength(1);
        expect(went).toEqual([CABINET]);
    });

    test('looking at the tab again does not wipe what is being typed', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
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
        const google = btn(AUTH.registerGoogle) as HTMLButtonElement;
        google.click();
        await flush();
        authStatus = { signedIn: true, email: 'other@b.c' };
        window.dispatchEvent(new Event('focus'));
        await flush();
        expect(btn(AUTH.registerGoogle)).toBe(google);
        expect((btn(AUTH.registerGoogle) as HTMLButtonElement).disabled).toBe(true);
        finish({ uid: 'g1', email: 'g@b.c', idToken: 't' });
        await flush();
        expect(deps.google).toHaveBeenCalledTimes(1);
    });

    test('the extension refuses to start the sign-in: that is said, with a retry, not a bare "signed in"', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        refuseBegin = true;
        await mount();
        btn(AUTH.registerGoogle).click();
        await flush();
        expect(handoffs).toHaveLength(0);
        expect(current()).toBe('Account');
        expect(ws().querySelector('.ws-error')!.textContent).toBe('Could not connect the extension.');
        expect(went).toEqual([]);
        refuseBegin = false;
        btn(T.retryConnect).click();
        await flush();
        expect(handoffs).toHaveLength(1);
        expect(went).toEqual([CABINET]);
    });

    test('a visitor who has moved to another step is not pulled back to Start by a late sign-in', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        await mount();
        let finish!: (u: { uid: string; email: string; idToken: string }) => void;
        deps.google.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        btn(AUTH.registerGoogle).click();
        await flush();
        ws().querySelectorAll<HTMLElement>('.ws-step')[0].click(); // back to Language meanwhile
        await flush();
        finish({ uid: 'g1', email: 'g@b.c', idToken: 't' });
        await flush();
        expect(current()).toBe('Language');
        expect(went).toEqual([]);
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
        // Continue from there is the cabinet too.
        btn('Continue').click();
        await flush();
        expect(went).toEqual([CABINET]);
    });
});

describe('after a reload', () => {
    const status = () => Array.from(ws().querySelectorAll('.ws-step')).map((x) => x.querySelector('.ws-dot.is-done') !== null);

    test('without the extension, the languages are kept in the browser and the page comes back to Account', async () => {
        extensionRefuses = true;
        await mount();
        setNative('ru');
        tile('es').click();
        await flush();
        btn('Continue').click();
        await flush();
        expect(current()).toBe('Account');
        await mount(); // the reload
        expect(current()).toBe('Account');
        expect(status()[0]).toBe(true);
        expect(store['lang.v1']).toBeUndefined();
    });

    test('without the extension, a skipped account stays skipped', async () => {
        extensionRefuses = true;
        localStorage.setItem('ws.local', JSON.stringify({ learning: 'es', native: 'en' }));
        await mount();
        btn('Skip for now').click();
        await flush();
        await mount();
        expect(current()).toBe('Start');
        expect(ws().querySelectorAll('.ws-step-status')[1].textContent).toBe('Skipped');
    });

    test('a language the edition does not offer is not taken from the browser memory', async () => {
        extensionRefuses = true;
        localStorage.setItem('ws.local', JSON.stringify({ learning: 'xx', native: 'en' }));
        await mount();
        expect(current()).toBe('Language');
    });

    test('the extension\'s record wins over the browser memory, and the browser keeps nothing when it answers', async () => {
        localStorage.setItem('ws.local', JSON.stringify({ learning: 'es', native: 'en', skippedAccount: true }));
        await mount();
        expect(current()).toBe('Language');
        localStorage.clear();
        tile('es').click();
        await flush();
        btn('Continue').click();
        await flush();
        expect(localStorage.getItem('ws.local')).toBeNull();
    });

    test('a site session from before is shown as signed in, not as a fresh form', async () => {
        extensionRefuses = true;
        localStorage.setItem('ws.local', JSON.stringify({ learning: 'es', native: 'en' }));
        deps.session.mockImplementation(async () => ({ uid: 'u1', email: 'a@b.c', idToken: 'id-token' }));
        await mount();
        expect(current()).toBe('Account');
        // Signed in on the site only: the line does not claim the extension.
        expect(ws().querySelector('.ws-ok')!.textContent).toBe('Signed in as a@b.c on lingogram.ai');
        expect(ws().querySelector('form')).toBeNull();
        expect(status()[1]).toBe(true);
        // No extension to hand it to: Continue is the last step here.
        btn('Continue').click();
        await flush();
        expect(current()).toBe('Start');
        expect(handoffs).toHaveLength(0);
    });

    test('with the extension, Continue hands that session over and goes on to the cabinet', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        deps.session.mockImplementation(async () => ({ uid: 'u1', email: 'a@b.c', idToken: 'id-token' }));
        await mount();
        expect(ws().querySelector('.ws-ok')).not.toBeNull();
        expect(handoffs).toHaveLength(0);
        btn('Continue').click();
        await flush();
        expect(handoffs).toEqual([{ customToken: 'custom-token', uid: 'u1', email: 'a@b.c', nonce: session['auth.pendingNonce'] }]);
        expect(went).toEqual([CABINET]);
    });

    test('signed in in the extension already: the site session is not even asked for', async () => {
        store['lang.v1'] = { learning: 'es', native: 'en' };
        authStatus = { signedIn: true, email: 'a@b.c' };
        await mount();
        expect(deps.session).not.toHaveBeenCalled();
    });
});

describe('Start', () => {
    const start = async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(current()).toBe('Start');
    };
    const go = () => ws().querySelector<HTMLButtonElement>('.ws-go')!;

    test('the still: the first video, a word clicked in its subtitles, its translation and Save', async () => {
        await start();
        expect(ws().querySelector('.ws-title')!.textContent).toBe(T.startTitle);
        expect(ws().querySelector<HTMLImageElement>('.ws-frame img')!.src).toBe('https://i.ytimg.com/vi/Kk1vR7BdTno/mqdefault.jpg');
        expect(ws().querySelector('.ws-frame-l1')!.textContent).toBe('We are looking back at the cosmic dawn');
        expect(ws().querySelector('.ws-frame-l1 mark')!.textContent).toBe('dawn');
        expect(ws().querySelector('.ws-frame-tr')!.textContent).toBe(T.demoWord);
        expect(ws().querySelector('.ws-frame-save')!.textContent).toBe(`\u2661 ${T.demoSave}`);
        expect(ws().querySelector('.ws-frame-cap')!.textContent).toBe(T.frameCaption);
    });

    test('the translation line under the subtitle shows only when the page language has one', async () => {
        await start();
        expect(ws().querySelector('.ws-frame-l2')).toBeNull();
        (window as any).__WELCOME_STEPS = { ...(window as any).__WELCOME_STEPS, i18n: { ...T, demoLine: 'Мы смотрим на рассвет Вселенной' } };
        await initSteps(document, window);
        await flush();
        expect(ws().querySelector('.ws-frame-l2')!.textContent).toBe('Мы смотрим на рассвет Вселенной');
    });

    test('opens a checked video for the language being learned, and remembers that setup is finished', async () => {
        await start();
        expect(go().firstChild!.textContent).toBe(T.watchFirst);
        expect(ws().querySelector('.ws-go-sub')!.textContent).toBe('Cosmic Dawn (Official NASA Trailer) \u00b7 YouTube');
        expect(ws().querySelector('.ws-after')!.textContent).toBe(T.startLead);
        go().click();
        await flush();
        expect(went).toEqual(['https://www.youtube.com/watch?v=Kk1vR7BdTno']);
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: true });
    });

    test('a language with no checked video searches YouTube in that language, subtitles only', async () => {
        store['lang.v1'] = { learning: 'ja', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(go().textContent).toBe(T.findVideo);
        expect(ws().querySelector('.ws-go-sub')).toBeNull();
        go().click();
        await flush();
        expect(went).toEqual(['https://www.youtube.com/results?search_query=%E6%97%A5%E6%9C%AC%E8%AA%9E&sp=EgIoAQ%3D%3D']);
    });

    test('with no extension: one message, the still, the install, and no switch that cannot switch', async () => {
        extensionRefuses = true;
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        await mount({ lang: 'ru', locales: [] });
        ws().querySelectorAll<HTMLElement>('.ws-step')[2].click();
        await flush();
        expect(ws().querySelector('.ws-title')!.textContent).toBe(T.updateTitle);
        expect(ws().querySelector('.ws-frame')).not.toBeNull();
        expect(ws().querySelector('.ws-install .ws-row-title')!.textContent).toBe(T.updateLead);
        expect(ws().querySelector('.ws-switch')).toBeNull();
        expect(ws().querySelector('.ws-go')).toBeNull();
        btn(T.notNow).click();
        await flush();
        expect(went).toEqual([]);
        expect(ws().hidden).toBe(true);
        expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(false);
    });

    test('word highlighting is one switch that writes the extension prefs', async () => {
        await start();
        expect(Array.from(ws().querySelectorAll('.ws-chips .ws-row-title')).map((n) => n.textContent)).toEqual([
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

    test('HDrezka: the button goes back to the ordinary welcome content, with how to start a film', async () => {
        edition = 'rezka';
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        store['welcome.v1'] = { skippedAccount: true, finished: false };
        await mount({ lang: 'ru', locales: [] });
        expect(ws().querySelector('.ws-after')!.textContent).toBe(T.startLeadRezka);
        expect(ws().querySelector('.ws-go-sub')).toBeNull();
        go().click();
        await flush();
        expect(ws().hidden).toBe(true);
        expect(document.querySelector<HTMLElement>('main.wl')!.hidden).toBe(false);
        expect(went).toEqual([]);
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: true });
    });
});

test('language names read in the page language, with the own name beside', () => {
    expect(languageLabel('ru', 'Русский', 'Russian', 'en')).toBe('Russian — Русский');
    expect(languageLabel('en', 'English', 'English', 'en')).toBe('English');
});
