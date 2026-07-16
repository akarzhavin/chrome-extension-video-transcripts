// Persisted per-browser-profile UI preferences for the extension. Shared by
// rezka + youtube apps. Lives in chrome.storage.local under a single key so
// adding a field doesn't multiply storage keys. chrome.storage.onChanged
// fires across tabs of the same profile, so opening two YouTube tabs keeps
// the sidebar state in sync.

export type OverlaySizeToken = 'small' | 'medium' | 'large';
export type OverlayLevelToken = 'low' | 'medium' | 'high';
export type OverlayEdgeToken = 'none' | 'shadow' | 'outline';

export interface Prefs {
    displayMode: 'single' | 'dual' | 'guess';
    overlayEnabled: boolean;
    sidebarCollapsed: boolean;
    // On-video overlay appearance. Stored as preset tokens (not raw px) so the
    // sidebar can drive them with a fixed set of preset buttons and the values
    // stay validated. SidebarUI maps these to concrete CSS custom properties.
    overlayFontSize: OverlaySizeToken;
    overlayColor: string; // hex, applies to the main line only
    overlayBottomOffset: OverlayLevelToken;
    overlayBgOpacity: OverlayLevelToken;
    overlayEdgeStyle: OverlayEdgeToken;
}

const PREFS_KEY = 'prefs.v1';

const DEFAULT_PREFS: Prefs = {
    displayMode: 'dual',
    overlayEnabled: true,
    sidebarCollapsed: false,
    overlayFontSize: 'medium',
    overlayColor: '#ffffff',
    overlayBottomOffset: 'medium',
    overlayBgOpacity: 'medium',
    // 'shadow' matches the pre-existing hard-coded text-shadow.
    overlayEdgeStyle: 'shadow',
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
    // Skip silently if the extension was reloaded and this content script is
    // now orphaned — chrome.storage would throw 'Extension context invalidated'.
    if (!chrome.runtime?.id) return;
    try {
        const current = await loadPrefs();
        const next: Prefs = { ...current, ...partial };
        await chrome.storage.local.set({ [PREFS_KEY]: next });
    } catch {
        // Prefs persistence is best-effort. Failures here (invalidated context,
        // quota exceeded) aren't actionable — next session falls back to
        // defaults or last-persisted values. No warn to keep the console clean.
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
