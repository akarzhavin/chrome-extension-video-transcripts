// The user's language pair for learning. Stored separately from UI `Prefs`
// because "unset" is meaningful here: until the user picks BOTH languages we
// show the first-run onboarding gate instead of guessing en/ru. Persisted in
// chrome.storage.local under its own key so absence == not-yet-configured.

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

/** English label for a track `lang` code (strips region, e.g. 'en-US' → English). */
export function labelForLanguage(code: string): string {
    const norm = (code || '').split('-')[0].toLowerCase();
    return SUPPORTED_LANGUAGES.find((l) => l.code === norm)?.label ?? code;
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

export async function saveLanguagePrefs(prefs: LanguagePrefs): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (!chrome.runtime?.id) return;
    try {
        await chrome.storage.local.set({ [LANG_KEY]: prefs });
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
