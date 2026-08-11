/**
 * @jest-environment jsdom
 */

function makeChromeStorage() {
    const store: Record<string, unknown> = {};
    const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];
    return {
        local: {
            get: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return Promise.resolve(out);
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(items)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
            _store: store,
        } as any,
        onChanged: {
            addListener: jest.fn((l: any) => { listeners.push(l); }),
            removeListener: jest.fn((l: any) => {
                const i = listeners.indexOf(l);
                if (i >= 0) listeners.splice(i, 1);
            }),
        } as any,
    };
}

const chromeStorage = makeChromeStorage();
// trackVia() reports through sendMessage, so the analytics assertions below
// read this mock rather than reaching for the network.
const sendMessageMock = jest.fn();
(global as any).chrome = {
    storage: chromeStorage,
    runtime: {
        id: 'test-extension-id',
        sendMessage: sendMessageMock,
        // isEmbed() treats a runtime without getManifest as the embed shim and
        // drops every event, so the stub needs one to exercise reporting.
        getManifest: () => ({ version: '1.0.0' }),
    },
};

import {
    SUPPORTED_LANGUAGES,
    labelForLanguage,
    loadLanguagePrefs,
    saveLanguagePrefs,
    onLanguagePrefsChanged,
} from '../src/languages';

beforeEach(() => {
    Object.keys((chromeStorage.local as any)._store).forEach((k) => {
        delete (chromeStorage.local as any)._store[k];
    });
    sendMessageMock.mockClear();
});

const configuredEvents = () =>
    sendMessageMock.mock.calls
        .map((c) => c[0])
        .filter((m) => m?.action === 'TRACK_EVENT' && m.event === 'languages_configured');

describe('SUPPORTED_LANGUAGES', () => {
    test('includes the core languages and has unique codes', () => {
        const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
        expect(codes).toContain('en');
        expect(codes).toContain('ru');
        expect(new Set(codes).size).toBe(codes.length); // no duplicates
    });

    test('every entry has a non-empty code, label and native name', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(lang.code).toBeTruthy();
            expect(lang.label).toBeTruthy();
            expect(lang.native).toBeTruthy();
        }
    });
});

describe('labelForLanguage', () => {
    test('maps known codes to their English label', () => {
        expect(labelForLanguage('en')).toBe('English');
        expect(labelForLanguage('ru')).toBe('Russian');
        expect(labelForLanguage('es')).toBe('Spanish');
    });

    test('strips region subtags (en-US → English)', () => {
        expect(labelForLanguage('en-US')).toBe('English');
        expect(labelForLanguage('pt-BR')).toBe('Portuguese');
    });

    test('falls back to the raw code for unknown languages', () => {
        expect(labelForLanguage('xx')).toBe('xx');
    });
});

describe('language prefs storage', () => {
    test('loadLanguagePrefs returns null when nothing is stored', async () => {
        expect(await loadLanguagePrefs()).toBeNull();
    });

    test('save then load round-trips the pair', async () => {
        await saveLanguagePrefs({ learning: 'en', native: 'ru' });
        expect(await loadLanguagePrefs()).toEqual({ learning: 'en', native: 'ru' });
    });

    test('loadLanguagePrefs returns null for partial/garbage values', async () => {
        (chromeStorage.local as any)._store['lang.v1'] = { learning: 'en' }; // missing native
        expect(await loadLanguagePrefs()).toBeNull();

        (chromeStorage.local as any)._store['lang.v1'] = 'not-an-object';
        expect(await loadLanguagePrefs()).toBeNull();

        (chromeStorage.local as any)._store['lang.v1'] = { learning: '', native: 'ru' };
        expect(await loadLanguagePrefs()).toBeNull();
    });

    test('onLanguagePrefsChanged fires with the new pair', async () => {
        const cb = jest.fn();
        const off = onLanguagePrefsChanged(cb);

        await saveLanguagePrefs({ learning: 'es', native: 'en' });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual({ learning: 'es', native: 'en' });

        off();
        await saveLanguagePrefs({ learning: 'fr', native: 'en' });
        expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
    });

    test('onLanguagePrefsChanged reports null when the stored value becomes invalid', async () => {
        const cb = jest.fn();
        onLanguagePrefsChanged(cb);
        // simulate a write of a malformed value under the key
        await (chromeStorage.local as any).set({ 'lang.v1': { learning: 'en' } });
        expect(cb).toHaveBeenCalledWith(null);
    });

    test('one configured pair reports one languages_configured', async () => {
        // Every picker binds a single `persist` to both selects, so choosing a
        // learning language and then a native one calls save twice — the second
        // time with the pair the first call already stored. This event is the
        // denominator of the onboarding funnel step, so a double count reads as
        // a step people pass more often than they do.
        await saveLanguagePrefs({ learning: 'es', native: 'en' }, 'onboarding');
        await saveLanguagePrefs({ learning: 'es', native: 'en' }, 'onboarding');
        expect(configuredEvents()).toHaveLength(1);
        expect(configuredEvents()[0].params).toMatchObject({
            learning: 'es',
            native: 'en',
            via: 'onboarding',
        });
    });

    test('a genuine re-pick still reports', async () => {
        // Deliberate: reconsidering is a signal about the picker's clarity, and
        // only the no-op repeat above is filtered.
        await saveLanguagePrefs({ learning: 'es', native: 'en' }, 'onboarding');
        await saveLanguagePrefs({ learning: 'fr', native: 'en' }, 'popup');
        expect(configuredEvents()).toHaveLength(2);
        expect(configuredEvents()[1].params.learning).toBe('fr');
    });

    test('an unchanged save still writes the pair through to storage', async () => {
        // Only the reporting is suppressed — the write is what other surfaces
        // observe via onLanguagePrefsChanged.
        await saveLanguagePrefs({ learning: 'de', native: 'ru' }, 'popup');
        (chromeStorage.local.set as jest.Mock).mockClear();
        await saveLanguagePrefs({ learning: 'de', native: 'ru' }, 'popup');
        expect(chromeStorage.local.set).toHaveBeenCalledTimes(1);
        expect(await loadLanguagePrefs()).toEqual({ learning: 'de', native: 'ru' });
    });

    test('saveLanguagePrefs no-ops when the extension context is invalidated', async () => {
        const realRuntime = (global as any).chrome.runtime;
        (global as any).chrome.runtime = {}; // no id
        (chromeStorage.local.set as jest.Mock).mockClear();
        try {
            await saveLanguagePrefs({ learning: 'en', native: 'ru' });
            expect(chromeStorage.local.set).not.toHaveBeenCalled();
        } finally {
            (global as any).chrome.runtime = realRuntime;
        }
    });
});
