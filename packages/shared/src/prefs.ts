// Persisted per-browser-profile UI preferences for the extension. Shared by
// rezka + youtube apps. Lives in chrome.storage.local under a single key so
// adding a field doesn't multiply storage keys. chrome.storage.onChanged
// fires across tabs of the same profile, so opening two YouTube tabs keeps
// the sidebar state in sync.
//
// Overlay APPEARANCE is per streaming site. The youtube app ships one build
// for both youtube.com and netflix.com, so a single shared blob meant that
// restyling subtitles on YouTube also restyled Netflix. The sites genuinely
// need different values — YouTube's overlay sits above a measured control-bar
// floor (--vtt-yt-controls-floor) that Netflix has no equivalent of, so the
// same "low" position token lands somewhere else on each. See `byPlatform`.

import { platformOf, type Platform } from './analytics';

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
    // Anonymous usage analytics. On by default; the popup's Privacy row flips
    // it. Read only by analytics-bg's track() gate — never branch on it
    // anywhere else (one gate, one place).
    analyticsEnabled: boolean;
}

// Exported for analytics-bg's gate, which reads the raw blob directly: it
// needs "storage error → treat as opted out", which loadPrefs (defaults on
// error, by design) cannot express.
export const PREFS_KEY = 'prefs.v1';

// The fields configured independently per streaming site. Everything NOT in
// this list is global: displayMode and sidebarCollapsed are how the user reads,
// not how one site looks, and analyticsEnabled is a consent flag that the
// service worker reads with no tab context at all — a per-site copy of it
// could not be resolved there, and must never exist.
export type ScopedPrefKey =
    | 'overlayEnabled'
    | 'overlayFontSize'
    | 'overlayColor'
    | 'overlayBottomOffset'
    | 'overlayBgOpacity'
    | 'overlayEdgeStyle';

export type ScopedPrefs = Pick<Prefs, ScopedPrefKey>;

export const SCOPED_PREF_KEYS: readonly ScopedPrefKey[] = [
    'overlayEnabled',
    'overlayFontSize',
    'overlayColor',
    'overlayBottomOffset',
    'overlayBgOpacity',
    'overlayEdgeStyle',
];

// Which site's appearance a read/write applies to. Reuses the analytics
// Platform labels rather than a raw hostname: they already fold youtu.be and
// Rezka's ~250 mirror domains into one id, so following a mirror redirect
// keeps your settings instead of silently starting a fresh scope.
export type PrefScope = Platform;

/**
 * The persisted shape. `Prefs` itself stays flat — it is the RESOLVED view
 * every caller consumes, and no consumer needs to know scoping exists.
 *
 * The scoped fields live at top level too, and that is not legacy cruft: the
 * top-level copy is the inheritance baseline a site falls back to until it has
 * been configured. An install upgrading from a build that predates scoping
 * therefore resolves to exactly the appearance it already had, on every site,
 * with no migration write. (A startup migration would have to race N content
 * scripts through savePrefs' read-modify-write, which has no compare-and-swap
 * and would drop a concurrent user click.)
 */
interface StoredPrefs extends Prefs {
    byPlatform?: Partial<Record<PrefScope, Partial<ScopedPrefs>>>;
}

/**
 * The calling context's scope. Content scripts get their page's host; the
 * popup and the service worker run on chrome-extension:// and fold into
 * 'other', which resolves globals correctly and scoped fields to the baseline
 * — the only coherent answer available without a tab.
 */
function currentScope(): PrefScope {
    try {
        return platformOf(location.hostname);
    } catch {
        return 'other';
    }
}

/**
 * Storage bytes → the flat resolved view for one scope:
 * DEFAULT_PREFS → stored top-level → byPlatform[scope].
 */
function resolve(raw: unknown, scope: PrefScope): Prefs {
    const stored: Partial<StoredPrefs> = isPrefs(raw) ? raw : {};
    const resolved: Prefs = { ...DEFAULT_PREFS, ...stored };
    const over = stored.byPlatform?.[scope];
    // Copy key-by-key rather than spreading `...over` wholesale: a scope object
    // must never be able to set a GLOBAL. A stray analyticsEnabled inside
    // byPlatform.youtube spreading over the top-level value would silently
    // re-consent a user who had opted out.
    if (over && typeof over === 'object') {
        for (const k of SCOPED_PREF_KEYS) {
            if (over[k] !== undefined) (resolved as unknown as Record<string, unknown>)[k] = over[k];
        }
    }
    // The resolved view is flat; byPlatform is storage-only.
    delete (resolved as Partial<StoredPrefs>).byPlatform;
    return resolved;
}

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
    // ON by default for new AND existing installs: loadPrefs spreads these
    // defaults first, so a stored blob written before this field existed
    // resolves to true with no migration.
    analyticsEnabled: true,
};

function isPrefs(value: unknown): value is Partial<StoredPrefs> {
    return typeof value === 'object' && value !== null;
}

export async function loadPrefs(scope: PrefScope = currentScope()): Promise<Prefs> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { ...DEFAULT_PREFS };
    try {
        const v = (await chrome.storage.local.get(PREFS_KEY)) as Record<string, unknown>;
        return resolve(v[PREFS_KEY], scope);
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export async function savePrefs(
    partial: Partial<Prefs>,
    scope: PrefScope = currentScope(),
): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    // Skip silently if the extension was reloaded and this content script is
    // now orphaned — chrome.storage would throw 'Extension context invalidated'.
    if (!chrome.runtime?.id) return;
    try {
        // Read the raw blob rather than loadPrefs(): this needs both the stored
        // shape (to leave OTHER scopes untouched) and the resolved view (as the
        // inheritance baseline). Still one get + one set, as before.
        const v = (await chrome.storage.local.get(PREFS_KEY)) as Record<string, unknown>;
        const raw = v[PREFS_KEY];
        const stored: Partial<StoredPrefs> = isPrefs(raw) ? { ...raw } : {};
        const resolved = resolve(raw, scope);

        const globals: Record<string, unknown> = {};
        const scoped: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(partial)) {
            if ((SCOPED_PREF_KEYS as readonly string[]).includes(k)) scoped[k] = val;
            else globals[k] = val;
        }

        const next: Partial<StoredPrefs> = { ...stored, ...globals };
        if (Object.keys(scoped).length > 0) {
            // The first write to a fresh scope snapshots all six RESOLVED fields,
            // not just the edited one, so the scope becomes self-contained and
            // stops tracking the top-level baseline. Note what this deliberately
            // does NOT do: touch the top-level copies. Writing them here would
            // re-converge every other site and undo the whole feature.
            const prev = stored.byPlatform?.[scope];
            const seed: Record<string, unknown> = {};
            for (const k of SCOPED_PREF_KEYS) {
                seed[k] = prev?.[k] !== undefined ? prev[k] : resolved[k];
            }
            next.byPlatform = { ...stored.byPlatform, [scope]: { ...seed, ...scoped } };
        }
        await chrome.storage.local.set({ [PREFS_KEY]: next });
    } catch {
        // Prefs persistence is best-effort. Failures here (invalidated context,
        // quota exceeded) aren't actionable — next session falls back to
        // defaults or last-persisted values. No warn to keep the console clean.
    }
}

export function onPrefsChanged(
    cb: (prefs: Prefs) => void,
    scope: PrefScope = currentScope(),
): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(PREFS_KEY in changes)) return;
        // Every scope shares one storage key, so a Netflix write wakes a YouTube
        // tab's listener too. Isolation comes from RESOLUTION, not filtering:
        // resolving through the subscriber's own scope means the callback then
        // carries values identical to what that tab already shows, and its
        // equality guards make the update a no-op.
        cb(resolve(changes[PREFS_KEY].newValue, scope));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
