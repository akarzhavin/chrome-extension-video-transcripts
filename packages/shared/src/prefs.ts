// Persisted per-browser-profile UI preferences for the extension. Shared by
// rezka + youtube apps. Lives in chrome.storage.local under a single key so
// adding a field doesn't multiply storage keys. chrome.storage.onChanged
// fires across tabs of the same profile, so opening two YouTube tabs keeps
// the sidebar state in sync.

export interface Prefs {
    displayMode: 'single' | 'dual' | 'guess';
    overlayEnabled: boolean;
    sidebarCollapsed: boolean;
}

const PREFS_KEY = 'prefs.v1';

const DEFAULT_PREFS: Prefs = {
    displayMode: 'dual',
    overlayEnabled: true,
    sidebarCollapsed: false,
};

function isPrefs(value: unknown): value is Partial<Prefs> {
    return typeof value === 'object' && value !== null;
}

export async function loadPrefs(): Promise<Prefs> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { ...DEFAULT_PREFS };
    try {
        const v = (await chrome.storage.local.get(PREFS_KEY)) as Record<string, unknown>;
        const raw = v[PREFS_KEY];
        return { ...DEFAULT_PREFS, ...(isPrefs(raw) ? raw : {}) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export async function savePrefs(partial: Partial<Prefs>): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
        const current = await loadPrefs();
        const next: Prefs = { ...current, ...partial };
        await chrome.storage.local.set({ [PREFS_KEY]: next });
    } catch (err) {
        console.warn('[Lingogram] savePrefs failed:', err);
    }
}

export function onPrefsChanged(cb: (prefs: Prefs) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(PREFS_KEY in changes)) return;
        const raw = changes[PREFS_KEY].newValue;
        cb({ ...DEFAULT_PREFS, ...(isPrefs(raw) ? raw : {}) });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
