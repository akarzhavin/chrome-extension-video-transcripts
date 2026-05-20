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
(global as any).chrome = { storage: chromeStorage };

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
        });
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
        });
    });
});
