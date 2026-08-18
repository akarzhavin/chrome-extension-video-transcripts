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
(global as any).chrome = { storage: chromeStorage, runtime: { id: 'test-extension-id' } };

import { loadPrefs, onPrefsChanged, savePrefs } from '../src/prefs';

beforeEach(() => {
    Object.keys((chromeStorage.local as any)._store).forEach((k) => {
        delete (chromeStorage.local as any)._store[k];
    });
});

describe('prefs', () => {
    test('loadPrefs returns defaults when storage is empty', async () => {
        const p = await loadPrefs();
        expect(p).toEqual({
            displayMode: 'dual',
            overlayEnabled: true,
            sidebarCollapsed: false,
            overlayFontSize: 'medium',
            overlayColor: '#ffffff',
            overlayBottomOffset: 'medium',
            overlayBgOpacity: 'medium',
            overlayEdgeStyle: 'shadow',
            analyticsEnabled: true,
        });
    });

    test('overlay style prefs round-trip and merge independently', async () => {
        await savePrefs({ overlayFontSize: 'large', overlayColor: '#ffd700' });
        let p = await loadPrefs();
        expect(p.overlayFontSize).toBe('large');
        expect(p.overlayColor).toBe('#ffd700');
        // Untouched style fields keep their defaults.
        expect(p.overlayBottomOffset).toBe('medium');
        expect(p.overlayBgOpacity).toBe('medium');

        await savePrefs({ overlayBottomOffset: 'high' });
        p = await loadPrefs();
        expect(p.overlayBottomOffset).toBe('high');
        expect(p.overlayFontSize).toBe('large'); // earlier change preserved
    });

    test('a blob written before analyticsEnabled existed resolves to true', async () => {
        // The "on by default, no migration" contract for installs upgrading
        // from a version that predates the field: loadPrefs spreads the
        // defaults first, so the absent key becomes true rather than undefined.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            displayMode: 'dual',
            overlayEnabled: true,
        };
        expect((await loadPrefs()).analyticsEnabled).toBe(true);
    });

    test('an explicit opt-out survives a round trip', async () => {
        await savePrefs({ analyticsEnabled: false });
        expect((await loadPrefs()).analyticsEnabled).toBe(false);
    });

    test('savePrefs merges with existing values', async () => {
        await savePrefs({ displayMode: 'single' });
        expect((await loadPrefs()).displayMode).toBe('single');
        expect((await loadPrefs()).overlayEnabled).toBe(true);

        await savePrefs({ sidebarCollapsed: true });
        const after = await loadPrefs();
        expect(after.displayMode).toBe('single');
        expect(after.sidebarCollapsed).toBe(true);
    });

    test('onPrefsChanged fires on cross-tab storage updates', async () => {
        const cb = jest.fn();
        const off = onPrefsChanged(cb);

        await savePrefs({ overlayEnabled: false });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toMatchObject({ overlayEnabled: false, displayMode: 'dual' });

        off();
        await savePrefs({ overlayEnabled: true });
        expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
    });

    test('loadPrefs survives garbage stored under the key', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = 'not-an-object';
        const p = await loadPrefs();
        expect(p).toEqual({
            displayMode: 'dual',
            overlayEnabled: true,
            sidebarCollapsed: false,
            overlayFontSize: 'medium',
            overlayColor: '#ffffff',
            overlayBottomOffset: 'medium',
            overlayBgOpacity: 'medium',
            overlayEdgeStyle: 'shadow',
            analyticsEnabled: true,
        });
    });

    // ---------------------------------------------------------------------
    // Per-platform overlay appearance
    //
    // The youtube app serves youtube.com and netflix.com from one build and
    // one storage area, so appearance is scoped per site while behaviour and
    // consent stay shared. jsdom's host is localhost, which platformOf maps to
    // 'other' — every test below passes its scope explicitly instead.
    // ---------------------------------------------------------------------

    test('a site with no saved scope inherits the pre-scoping top-level values', async () => {
        // A blob written by a build that predates scoping: one shared
        // appearance, tuned on YouTube, sitting at the top level.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayFontSize: 'large',
            overlayColor: '#ffd700',
        };
        // Both sites resolve to it, so upgrading changes nothing visually.
        expect((await loadPrefs('youtube')).overlayFontSize).toBe('large');
        expect((await loadPrefs('netflix')).overlayFontSize).toBe('large');
        expect((await loadPrefs('netflix')).overlayColor).toBe('#ffd700');
        // Fields never configured still fall through to the factory defaults.
        expect((await loadPrefs('netflix')).overlayBgOpacity).toBe('medium');
    });

    test('a YouTube appearance change does not follow to Netflix', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { overlayFontSize: 'large' };
        await savePrefs({ overlayFontSize: 'small' }, 'youtube');

        expect((await loadPrefs('youtube')).overlayFontSize).toBe('small');
        expect((await loadPrefs('netflix')).overlayFontSize).toBe('large');
        // The baseline itself must survive untouched. If a scoped write ever
        // leaked to the top level, every other site would re-converge on it and
        // the whole feature would quietly become a no-op — so assert it here.
        expect((chromeStorage.local as any)._store['prefs.v1'].overlayFontSize).toBe('large');
    });

    test('the first write to a fresh scope snapshots all six scoped fields', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayColor: '#ffd700',
            overlayEnabled: false,
        };
        await savePrefs({ overlayFontSize: 'large' }, 'youtube');

        // Editing one field pins all six, so the scope stops tracking the
        // top-level baseline rather than half-following it forever.
        expect((chromeStorage.local as any)._store['prefs.v1'].byPlatform.youtube).toEqual({
            overlayEnabled: false,         // inherited from the baseline
            overlayFontSize: 'large',      // the actual edit
            overlayColor: '#ffd700',       // inherited from the baseline
            overlayBottomOffset: 'medium', // from DEFAULT_PREFS
            overlayBgOpacity: 'medium',
            overlayEdgeStyle: 'shadow',
        });
    });

    test('global prefs stay shared across scopes and stay at the top level', async () => {
        await savePrefs({ displayMode: 'single', analyticsEnabled: false }, 'youtube');

        expect((await loadPrefs('netflix')).displayMode).toBe('single');
        expect((await loadPrefs('rezka')).analyticsEnabled).toBe(false);

        const raw = (chromeStorage.local as any)._store['prefs.v1'];
        // analytics-bg's consent gate reads this exact path from the service
        // worker, which has no tab and so cannot resolve a scope.
        expect(raw.analyticsEnabled).toBe(false);
        expect(raw.displayMode).toBe('single');
        expect(raw.byPlatform?.youtube?.displayMode).toBeUndefined();
        expect(raw.byPlatform?.youtube?.analyticsEnabled).toBeUndefined();
    });

    test('overlayEnabled is per-platform', async () => {
        await savePrefs({ overlayEnabled: false }, 'youtube');
        expect((await loadPrefs('youtube')).overlayEnabled).toBe(false);
        expect((await loadPrefs('netflix')).overlayEnabled).toBe(true);
    });

    test('onPrefsChanged resolves per scope: a Netflix write leaves YouTube values intact', async () => {
        const yt = jest.fn();
        const off = onPrefsChanged(yt, 'youtube');

        await savePrefs({ overlayFontSize: 'small' }, 'netflix');

        // One shared storage key, so the listener does fire — but resolved
        // through YouTube's scope the values are unchanged, which is what makes
        // the sidebar's update a no-op instead of a repaint.
        expect(yt).toHaveBeenCalledTimes(1);
        expect(yt.mock.calls[0][0].overlayFontSize).toBe('medium');
        off();
    });

    test('a malformed byPlatform is ignored and cannot override a global', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { displayMode: 'dual', byPlatform: 'nope' };
        expect((await loadPrefs('youtube')).overlayFontSize).toBe('medium');

        (chromeStorage.local as any)._store['prefs.v1'] = {
            byPlatform: { youtube: { displayMode: 'single', overlayFontSize: 'large' } },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayFontSize).toBe('large');
        // Scoped resolution copies known appearance keys only. A global riding
        // along inside a scope object is dropped — the case that matters is
        // analyticsEnabled, where honouring it would re-consent an opted-out user.
        expect(p.displayMode).toBe('dual');
    });

    test('savePrefs skips silently when extension context is invalidated', async () => {
        // After an extension reload, stale content scripts lose chrome.runtime.id.
        // savePrefs should no-op rather than logging warnings for every toggle.
        const realRuntime = (global as any).chrome.runtime;
        (global as any).chrome.runtime = {}; // no id
        (chromeStorage.local.set as jest.Mock).mockClear();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await savePrefs({ displayMode: 'single' });
            expect(chromeStorage.local.set).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
            (global as any).chrome.runtime = realRuntime;
        }
    });
});
