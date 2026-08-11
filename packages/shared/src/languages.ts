// The user's language pair for learning. Stored separately from UI `Prefs`
// because "unset" is meaningful here: until the user picks BOTH languages we
// show the first-run onboarding gate instead of guessing en/ru. Persisted in
// chrome.storage.local under its own key so absence == not-yet-configured.
import { trackVia } from './analytics';

export interface LanguagePrefs {
    /** BCP-47 primary code of the language being learned, e.g. 'en', 'es'. */
    learning: string;
    /** Code used for the translated / secondary (native) track. */
    native: string;
}

export interface SupportedLanguage {
    /** Matches the prefix of a YouTube caption track's `lang`. */
    code: string;
    /** English name — doubles as the sidebar track display name. */
    label: string;
    /** Endonym shown in the picker. */
    native: string;
}

// Common caption languages. `label` doubles as the track name shown in the
// sidebar, so name-based track matching (AppState) keeps working.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
    { code: 'en', label: 'English', native: 'English' },
    { code: 'es', label: 'Spanish', native: 'Español' },
    { code: 'pt', label: 'Portuguese', native: 'Português' },
    { code: 'fr', label: 'French', native: 'Français' },
    { code: 'de', label: 'German', native: 'Deutsch' },
    { code: 'it', label: 'Italian', native: 'Italiano' },
    { code: 'nl', label: 'Dutch', native: 'Nederlands' },
    { code: 'ru', label: 'Russian', native: 'Русский' },
    { code: 'uk', label: 'Ukrainian', native: 'Українська' },
    { code: 'pl', label: 'Polish', native: 'Polski' },
    { code: 'cs', label: 'Czech', native: 'Čeština' },
    { code: 'sk', label: 'Slovak', native: 'Slovenčina' },
    { code: 'bg', label: 'Bulgarian', native: 'Български' },
    { code: 'sr', label: 'Serbian', native: 'Српски' },
    { code: 'hr', label: 'Croatian', native: 'Hrvatski' },
    { code: 'sl', label: 'Slovenian', native: 'Slovenščina' },
    { code: 'ro', label: 'Romanian', native: 'Română' },
    { code: 'hu', label: 'Hungarian', native: 'Magyar' },
    { code: 'el', label: 'Greek', native: 'Ελληνικά' },
    { code: 'tr', label: 'Turkish', native: 'Türkçe' },
    { code: 'sv', label: 'Swedish', native: 'Svenska' },
    { code: 'no', label: 'Norwegian', native: 'Norsk' },
    { code: 'da', label: 'Danish', native: 'Dansk' },
    { code: 'fi', label: 'Finnish', native: 'Suomi' },
    { code: 'et', label: 'Estonian', native: 'Eesti' },
    { code: 'lv', label: 'Latvian', native: 'Latviešu' },
    { code: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
    { code: 'ar', label: 'Arabic', native: 'العربية' },
    { code: 'he', label: 'Hebrew', native: 'עברית' },
    { code: 'fa', label: 'Persian', native: 'فارسی' },
    { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { code: 'bn', label: 'Bengali', native: 'বাংলা' },
    { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
    { code: 'te', label: 'Telugu', native: 'తెలుగు' },
    { code: 'th', label: 'Thai', native: 'ไทย' },
    { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
    { code: 'fil', label: 'Filipino', native: 'Filipino' },
    { code: 'ja', label: 'Japanese', native: '日本語' },
    { code: 'ko', label: 'Korean', native: '한국어' },
    { code: 'zh', label: 'Chinese', native: '中文' },
];

const LANG_KEY = 'lang.v1';

/** English label for a track `lang` code (strips region, e.g. 'en-US'/'pt_BR' → English/Portuguese). */
export function labelForLanguage(code: string): string {
    const norm = (code || '').split(/[-_]/)[0].toLowerCase();
    return SUPPORTED_LANGUAGES.find((l) => l.code === norm)?.label ?? code;
}

/** Endonym (native name) for a code, falling back to the English label / code. */
export function nativeForLanguage(code: string): string {
    const norm = (code || '').split(/[-_]/)[0].toLowerCase();
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === norm);
    return lang?.native ?? lang?.label ?? code;
}

/** Compact uppercase abbreviation for the language chip ('en-US' → EN, 'pt_BR' → PT). */
export function shortCodeForLanguage(code: string): string {
    return (code || '').split(/[-_]/)[0].toUpperCase();
}

// Representative flag per supported language (language ≠ country, so these are
// the conventional "best fit" choices). Used for the sidebar language-pair chip.
const LANGUAGE_FLAGS: Record<string, string> = {
    en: '🇬🇧', es: '🇪🇸', pt: '🇵🇹', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', nl: '🇳🇱',
    uk: '🇺🇦', pl: '🇵🇱', cs: '🇨🇿', sk: '🇸🇰', bg: '🇧🇬', sr: '🇷🇸',
    hr: '🇭🇷', sl: '🇸🇮', ro: '🇷🇴', hu: '🇭🇺', el: '🇬🇷', tr: '🇹🇷', sv: '🇸🇪',
    no: '🇳🇴', da: '🇩🇰', fi: '🇫🇮', et: '🇪🇪', lv: '🇱🇻', lt: '🇱🇹', ar: '🇸🇦',
    he: '🇮🇱', fa: '🇮🇷', hi: '🇮🇳', bn: '🇧🇩', ta: '🇮🇳', te: '🇮🇳', th: '🇹🇭',
    vi: '🇻🇳', id: '🇮🇩', ms: '🇲🇾', fil: '🇵🇭', ja: '🇯🇵', ko: '🇰🇷', zh: '🇨🇳',
};

// Region-specific overrides where the base-language flag would be wrong for a
// store locale (e.g. Brazilian Portuguese should not show the Portugal flag).
const REGION_FLAGS: Record<string, string> = {
    pt_br: '🇧🇷', en_us: '🇺🇸', en_au: '🇦🇺', zh_tw: '🇹🇼', es_419: '🌎',
};

/** Flag emoji for a language/locale code (region-aware), or '' when none is mapped. */
export function flagForLanguage(code: string): string {
    const c = (code || '').toLowerCase().replace('-', '_');
    return REGION_FLAGS[c] ?? LANGUAGE_FLAGS[c.split('_')[0]] ?? '';
}

function parsePrefs(raw: unknown): LanguagePrefs | null {
    if (!raw || typeof raw !== 'object') return null;
    const { learning, native } = raw as Record<string, unknown>;
    if (typeof learning === 'string' && learning && typeof native === 'string' && native) {
        return { learning, native };
    }
    return null;
}

/** Returns null when the user has not configured both languages yet. */
export async function loadLanguagePrefs(): Promise<LanguagePrefs | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    try {
        const v = (await chrome.storage.local.get(LANG_KEY)) as Record<string, unknown>;
        return parsePrefs(v[LANG_KEY]);
    } catch {
        return null;
    }
}

/**
 * @param via Which surface the pair was chosen on, for analytics. Optional so
 *   the existing call sites keep compiling; they pass it explicitly.
 *
 * The event lives here rather than at the three call sites so "the pair was
 * configured" cannot be recorded in one place and missed in another. It fires
 * on every *change*, so a user who reconsiders produces several — accepted
 * deliberately: re-picking is itself a signal about the picker's clarity.
 *
 * A save that changes neither language is not a re-pick, though, and is
 * reported by nobody. Every picker binds one `persist` to both selects, so
 * choosing a learning language and then a native one calls this twice, the
 * second time with the pair the first call already stored. Left unfiltered
 * that made languages_configured outnumber the users who configured anything
 * — and this event is the denominator of the onboarding funnel step the whole
 * feature exists to measure, so an inflated count reads as a step people pass
 * more often than they do.
 */
export async function saveLanguagePrefs(
    prefs: LanguagePrefs,
    via: 'onboarding' | 'popup' | 'sidebar' | 'unknown' = 'unknown',
): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (!chrome.runtime?.id) return;
    try {
        const previous = await loadLanguagePrefs();
        await chrome.storage.local.set({ [LANG_KEY]: prefs });
        // Compared before the write, against what was actually stored rather
        // than against a cached copy — the popup and the sidebar can both be
        // open on the same pair.
        const unchanged =
            previous !== null &&
            previous.learning === prefs.learning &&
            previous.native === prefs.native;
        if (unchanged) return;
        trackVia('languages_configured', {
            learning: prefs.learning,
            native: prefs.native,
            via,
        });
    } catch {
        // best-effort; next session re-reads or re-prompts.
    }
}

export function onLanguagePrefsChanged(cb: (prefs: LanguagePrefs | null) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(LANG_KEY in changes)) return;
        cb(parsePrefs(changes[LANG_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
