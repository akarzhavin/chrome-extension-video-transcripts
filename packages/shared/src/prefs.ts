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

// Font size is a percentage (50-400, step 5) rather than a 3-way token: a
// fixed small/medium/large left the whole 100-150% range — where most people
// land — unreachable. Position/backdrop/edge stay 3-4 way presets; there is
// no equivalent "everyone wants a value in between" complaint about those.
export type OverlaySizePercent = number;
export type OverlayLevelToken = 'low' | 'medium' | 'high';
export type OverlayEdgeToken = 'none' | 'shadow' | 'outline';
// The seven CEA-708 font classes — the same set YouTube, Netflix, and the
// FCC (47 CFR 79.103) all expose. Each resolves to a system font stack in
// CSS; nothing is bundled, matching the BBC's own guidance that a platform
// font beats a shipped one for on-screen legibility. 'smallCaps' is not a
// distinct typeface (none exists reliably cross-platform) — it is
// font-variant-caps applied to the proportional-sans stack.
export type OverlayFontFamily =
    | 'monoSerif'
    | 'propSerif'
    | 'monoSans'
    | 'propSans'
    | 'casual'
    | 'cursive'
    | 'smallCaps';

export interface Prefs {
    displayMode: 'single' | 'dual' | 'guess';
    overlayEnabled: boolean;
    sidebarCollapsed: boolean;
    // On-video overlay appearance. Most fields are preset tokens (not raw px)
    // so the sidebar can drive them with a fixed set of preset buttons and the
    // values stay validated. SidebarUI maps these to concrete CSS custom
    // properties. Sizes are the exception — see OverlaySizePercent above.
    overlayFontFamily: OverlayFontFamily;
    overlayFontSize: OverlaySizePercent; // % of the 24px base, main line
    overlayColor: string; // hex, main line
    // The translation line used to be a fixed 0.75x the main size and a fixed
    // gold hardcoded in CSS. Both are now independent: a language learner may
    // want the translation tiny (a hint) or just as large (reading both).
    overlaySubFontSize: OverlaySizePercent;
    overlaySubColor: string; // hex
    overlayTextOpacity: number; // 0-1, glyph fill only — see overlayBgOpacity for the box
    overlayBgColor: string; // hex, the caption box behind both lines
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
    | 'overlayFontFamily'
    | 'overlayFontSize'
    | 'overlayColor'
    | 'overlaySubFontSize'
    | 'overlaySubColor'
    | 'overlayTextOpacity'
    | 'overlayBgColor'
    | 'overlayBottomOffset'
    | 'overlayBgOpacity'
    | 'overlayEdgeStyle';

export type ScopedPrefs = Pick<Prefs, ScopedPrefKey>;

export const SCOPED_PREF_KEYS: readonly ScopedPrefKey[] = [
    'overlayEnabled',
    'overlayFontFamily',
    'overlayFontSize',
    'overlayColor',
    'overlaySubFontSize',
    'overlaySubColor',
    'overlayTextOpacity',
    'overlayBgColor',
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

// Font size used to be a 3-way token (small/medium/large), not a percentage.
// Installs upgrading from that build have exactly those three strings sitting
// under overlayFontSize/overlaySubFontSize — at the top level, and possibly
// inside byPlatform too, since scoped writes existed before this change.
// Coercing at read time (rather than migrating storage) keeps the same
// no-migration-write contract the byPlatform split itself relies on.
// Colors reach style.setProperty and, for the custom-swatch well, the
// `background` SHORTHAND -- which accepts url(). A stored color is therefore a
// CSS sink, validated here once rather than at each sink. Nothing hostile can
// write prefs.v1 today (the sole external entry point is origin-gated and
// touches auth state only), so this is defence in depth -- and it also stops a
// non-string from throwing in hexLuminance and aborting style application.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function coerceColor(v: unknown, fallback: string): string {
    return typeof v === 'string' && HEX_COLOR.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

const COLOR_PREF_KEYS = ['overlayColor', 'overlaySubColor', 'overlayBgColor'] as const;

const LEGACY_SIZE_TOKEN_PCT: Record<string, number> = { small: 75, medium: 100, large: 150 };
function coerceSize(v: unknown, fallback: number): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v in LEGACY_SIZE_TOKEN_PCT) return LEGACY_SIZE_TOKEN_PCT[v];
    return fallback;
}

/**
 * Storage bytes → the flat resolved view for one scope:
 * DEFAULT_PREFS → stored top-level → byPlatform[scope].
 */
function resolve(raw: unknown, scope: PrefScope): Prefs {
    const stored: Partial<StoredPrefs> = isPrefs(raw) ? raw : {};
    const resolved: Prefs = { ...DEFAULT_PREFS, ...stored };
    resolved.overlayFontSize = coerceSize(stored.overlayFontSize, DEFAULT_PREFS.overlayFontSize);
    resolved.overlaySubFontSize = coerceSize(stored.overlaySubFontSize, DEFAULT_PREFS.overlaySubFontSize);
    const topLevelSize = resolved.overlayFontSize;
    const topLevelSubSize = resolved.overlaySubFontSize;
    const over = stored.byPlatform?.[scope];
    // Copy key-by-key rather than spreading `...over` wholesale: a scope object
    // must never be able to set a GLOBAL. A stray analyticsEnabled inside
    // byPlatform.youtube spreading over the top-level value would silently
    // re-consent a user who had opted out.
    if (over && typeof over === 'object') {
        for (const k of SCOPED_PREF_KEYS) {
            if (over[k] !== undefined) (resolved as unknown as Record<string, unknown>)[k] = over[k];
        }
        // Re-coerce AFTER the loop above, falling back to the value resolved from
        // the top level -- NOT to resolved[k], which the loop has already
        // overwritten with the raw scoped value. Passing the garbage as its own
        // fallback let it through and rendered as `NaNpx`.
        if (over.overlayFontSize !== undefined) resolved.overlayFontSize = coerceSize(over.overlayFontSize, topLevelSize);
        if (over.overlaySubFontSize !== undefined) resolved.overlaySubFontSize = coerceSize(over.overlaySubFontSize, topLevelSubSize);
    }
    // Last, so it covers both the top-level and the scoped value.
    for (const k of COLOR_PREF_KEYS) {
        resolved[k] = coerceColor(resolved[k], DEFAULT_PREFS[k]);
    }
    // The resolved view is flat; byPlatform is storage-only.
    delete (resolved as Partial<StoredPrefs>).byPlatform;
    return resolved;
}

const DEFAULT_PREFS: Prefs = {
    displayMode: 'dual',
    overlayEnabled: true,
    sidebarCollapsed: false,
    overlayFontFamily: 'propSans',
    overlayFontSize: 100,
    overlayColor: '#ffffff',
    overlaySubFontSize: 75,
    // Matches the pre-existing hardcoded translation-line gold.
    overlaySubColor: '#ffd700',
    overlayTextOpacity: 1,
    overlayBgColor: '#000000',
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
