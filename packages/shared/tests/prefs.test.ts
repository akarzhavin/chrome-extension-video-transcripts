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
            overlayFontFamily: 'propSans',
            overlayFontSize: 100,
            overlayColor: '#ffffff',
            overlaySubFontSize: 75,
            overlaySubColor: '#ffd700',
            overlayTextOpacity: 1,
            overlayBgColor: '#000000',
            overlayBottomOffset: 'medium',
            overlayBgOpacity: 'medium',
            overlayEdgeStyle: 'shadow',
            analyticsEnabled: true,
            theme: 'dark',
        });
    });

    test('overlay style prefs round-trip and merge independently', async () => {
        await savePrefs({ overlayFontSize: 150, overlayColor: '#ffd700' });
        let p = await loadPrefs();
        expect(p.overlayFontSize).toBe(150);
        expect(p.overlayColor).toBe('#ffd700');
        // Untouched style fields keep their defaults.
        expect(p.overlayBottomOffset).toBe('medium');
        expect(p.overlayBgOpacity).toBe('medium');

        await savePrefs({ overlayBottomOffset: 'high' });
        p = await loadPrefs();
        expect(p.overlayBottomOffset).toBe('high');
        expect(p.overlayFontSize).toBe(150); // earlier change preserved
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
            overlayFontFamily: 'propSans',
            overlayFontSize: 100,
            overlayColor: '#ffffff',
            overlaySubFontSize: 75,
            overlaySubColor: '#ffd700',
            overlayTextOpacity: 1,
            overlayBgColor: '#000000',
            overlayBottomOffset: 'medium',
            overlayBgOpacity: 'medium',
            overlayEdgeStyle: 'shadow',
            analyticsEnabled: true,
            theme: 'dark',
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
            overlayFontSize: 150,
            overlayColor: '#ffd700',
        };
        // Both sites resolve to it, so upgrading changes nothing visually.
        expect((await loadPrefs('youtube')).overlayFontSize).toBe(150);
        expect((await loadPrefs('netflix')).overlayFontSize).toBe(150);
        expect((await loadPrefs('netflix')).overlayColor).toBe('#ffd700');
        // Fields never configured still fall through to the factory defaults.
        expect((await loadPrefs('netflix')).overlayBgOpacity).toBe('medium');
    });

    test('a YouTube appearance change does not follow to Netflix', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { overlayFontSize: 150 };
        await savePrefs({ overlayFontSize: 75 }, 'youtube');

        expect((await loadPrefs('youtube')).overlayFontSize).toBe(75);
        expect((await loadPrefs('netflix')).overlayFontSize).toBe(150);
        // The baseline itself must survive untouched. If a scoped write ever
        // leaked to the top level, every other site would re-converge on it and
        // the whole feature would quietly become a no-op — so assert it here.
        expect((chromeStorage.local as any)._store['prefs.v1'].overlayFontSize).toBe(150);
    });

    test('the first write to a fresh scope snapshots all scoped fields', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayColor: '#ffd700',
            overlayEnabled: false,
        };
        await savePrefs({ overlayFontSize: 150 }, 'youtube');

        // Editing one field pins every scoped field, so the scope stops
        // tracking the top-level baseline rather than half-following it forever.
        expect((chromeStorage.local as any)._store['prefs.v1'].byPlatform.youtube).toEqual({
            overlayEnabled: false,           // inherited from the baseline
            overlayFontFamily: 'propSans',   // from DEFAULT_PREFS
            overlayFontSize: 150,            // the actual edit
            overlayColor: '#ffd700',         // inherited from the baseline
            overlaySubFontSize: 75,
            overlaySubColor: '#ffd700',
            overlayTextOpacity: 1,
            overlayBgColor: '#000000',
            overlayBottomOffset: 'medium',
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

        await savePrefs({ overlayFontSize: 75 }, 'netflix');

        // One shared storage key, so the listener does fire — but resolved
        // through YouTube's scope the values are unchanged, which is what makes
        // the sidebar's update a no-op instead of a repaint.
        expect(yt).toHaveBeenCalledTimes(1);
        expect(yt.mock.calls[0][0].overlayFontSize).toBe(100);
        off();
    });

    test('a malformed byPlatform is ignored and cannot override a global', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { displayMode: 'dual', byPlatform: 'nope' };
        expect((await loadPrefs('youtube')).overlayFontSize).toBe(100);

        (chromeStorage.local as any)._store['prefs.v1'] = {
            byPlatform: { youtube: { displayMode: 'single', overlayFontSize: 150 } },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayFontSize).toBe(150);
        // Scoped resolution copies known appearance keys only. A global riding
        // along inside a scope object is dropped — the case that matters is
        // analyticsEnabled, where honouring it would re-consent an opted-out user.
        expect(p.displayMode).toBe('dual');
    });

    // ---------------------------------------------------------------------
    // Legacy size tokens
    //
    // Font size used to be a 3-way token (small/medium/large). Installs
    // upgrading from that build have those exact strings sitting under
    // overlayFontSize/overlaySubFontSize, at the top level and possibly
    // inside byPlatform too, since scoped writes existed before this change.
    // ---------------------------------------------------------------------

    test('a legacy size token at the top level resolves to its percent equivalent', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { overlayFontSize: 'large' };
        expect((await loadPrefs('youtube')).overlayFontSize).toBe(150);
    });

    test('a legacy size token inside byPlatform resolves to its percent equivalent', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = {
            byPlatform: { youtube: { overlayFontSize: 'small', overlaySubFontSize: 'large' } },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayFontSize).toBe(75);
        expect(p.overlaySubFontSize).toBe(150);
    });

    test('an unrecognized size value falls back to the default rather than propagating garbage', async () => {
        (chromeStorage.local as any)._store['prefs.v1'] = { overlayFontSize: 'huge' };
        expect((await loadPrefs('youtube')).overlayFontSize).toBe(100);
    });

    test('an unrecognized size token inside byPlatform falls back to the top-level value, not to itself', async () => {
        // Regression: the scoped re-coercion passed the already-overwritten value
        // as its own fallback, so garbage survived and rendered as `NaNpx`.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayFontSize: 150,
            byPlatform: { youtube: { overlayFontSize: 'huge' } },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayFontSize).toBe(150);
        expect(Number.isFinite(p.overlayFontSize)).toBe(true);
    });

    test('a non-hex color is replaced by the default rather than reaching a CSS sink', async () => {
        // Colors land in style.setProperty and in the `background` shorthand,
        // which accepts url(). They must never pass through unvalidated.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayColor: 'url(https://evil.example/x.png)',
            overlaySubColor: null,
            byPlatform: { youtube: { overlayBgColor: '#000; background: url(https://evil)' } },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayColor).toBe('#ffffff');
        expect(p.overlayBgColor).toBe('#000000');
        for (const c of [p.overlayColor, p.overlaySubColor, p.overlayBgColor]) {
            expect(c).toMatch(/^#[0-9a-f]{6}$/);
        }
    });

    test('a globals-only write does not delete a scope another tab created meanwhile', async () => {
        // savePrefs is read-modify-write with no compare-and-swap. byPlatform
        // turned a one-field race into a whole-bucket one: the popup's writes
        // are all bare (displayMode/analytics) and never rebuild byPlatform, so
        // a stale copy would wipe a scope saved between the read and the set.
        (chromeStorage.local as any)._store['prefs.v1'] = { displayMode: 'dual' };

        // Interleave precisely: let the popup's FIRST get return the empty blob,
        // then land the netflix write before the popup reaches its set. The
        // guard re-reads just before writing, so it must pick the netflix
        // scope up from that second read.
        const impl = (chromeStorage.local.get as jest.Mock).getMockImplementation() as any;
        let armed = true; // one-shot, and disarmed BEFORE the nested write re-enters
        const spy = jest.spyOn(chromeStorage.local, 'get').mockImplementation((async (key: string) => {
            if (armed) {
                armed = false;
                const stale = await impl(key);                          // popup's baseline read
                await savePrefs({ overlayColor: '#00ff00' }, 'netflix'); // other tab writes
                return stale;                                           // popup carries stale data
            }
            return impl(key);                                           // the guard's fresh read
        }) as any);
        try {
            await savePrefs({ displayMode: 'single' });
        } finally {
            // spyOn().mockRestore() would strip the suite's own jest.fn()
            // implementation off `get`, so put it back explicitly.
            (chromeStorage.local.get as jest.Mock).mockImplementation(impl);
        }

        // Assert on the stored blob: the popup's global landed AND the scope
        // the other tab created in the gap is still there.
        const blob = (chromeStorage.local as any)._store['prefs.v1'];
        expect(blob.displayMode).toBe('single');
        expect(blob.byPlatform?.netflix?.overlayColor).toBe('#00ff00');
        expect((await loadPrefs('netflix')).overlayColor).toBe('#00ff00');
    });

    test('an out-of-range or non-finite size is clamped rather than rendered', async () => {
        // overlaySizePx does unguarded arithmetic, so NaN would render `NaNpx`.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayFontSize: Number.NaN,
            byPlatform: { youtube: { overlaySubFontSize: 100000 } },
        };
        const p = await loadPrefs('youtube');
        expect(Number.isFinite(p.overlayFontSize)).toBe(true);
        expect(p.overlaySubFontSize).toBeLessThanOrEqual(400);
        expect(p.overlayFontSize).toBeGreaterThanOrEqual(50);
    });

    test('an unrecognized preset token falls back to its default', async () => {
        // A bad token is a lookup miss in SidebarUI's maps, and
        // setProperty(name, undefined) writes the literal string "undefined"
        // rather than clearing the property — so it must not survive resolution.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            overlayEdgeStyle: 'bogus',
            overlayEnabled: 'yes-please',
            byPlatform: {
                youtube: { overlayFontFamily: 'comic', overlayBottomOffset: 42, overlayBgOpacity: null },
            },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayEdgeStyle).toBe('shadow');
        expect(p.overlayFontFamily).toBe('propSans');
        expect(p.overlayBottomOffset).toBe('medium');
        expect(p.overlayBgOpacity).toBe('medium');
        expect(typeof p.overlayEnabled).toBe('boolean');
    });

    test("the backdrop accepts 'off', which Position still rejects", async () => {
        // 'off' is a real fourth backdrop preset (a fully transparent caption
        // box), but the two controls no longer share a value set: a caption
        // still has to sit somewhere, so Position has no 'off' and must fall
        // back rather than persist it.
        (chromeStorage.local as any)._store['prefs.v1'] = {
            byPlatform: {
                youtube: { overlayBgOpacity: 'off', overlayBottomOffset: 'off' },
            },
        };
        const p = await loadPrefs('youtube');
        expect(p.overlayBgOpacity).toBe('off');
        expect(p.overlayBottomOffset).toBe('medium');
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
