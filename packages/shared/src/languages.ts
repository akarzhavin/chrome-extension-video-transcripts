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
    via: 'onboarding' | 'popup' | 'sidebar' | 'welcome' | 'site' | 'unknown' = 'unknown',
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

// Gender of "I" and "you" in a translation (english repo, spec 023 FR-011b;
// mirrors dictionary-service features/subtitles/gender.go). Strong: verbs or pronouns
// show it; adjective: only adjectives and participles. The other targets
// need no second track.
const GENDER_STRONG = ['ru', 'uk', 'pl', 'cs', 'sk', 'sl', 'sr', 'hr', 'hi', 'he', 'ar', 'th', 'vi'];
const GENDER_ADJECTIVE = ['es', 'pt', 'it', 'fr', 'ro', 'el', 'bg', 'lv', 'lt'];
// Often leave the gender of "I" unshown (Arabic past tense): last as a hint.
const GENDER_HIDDEN = ['ar', 'th', 'vi'];
/**
 * Hint languages the cheap model is measured to read (english repo, spec 023 R21, spec 025 R1);
 * admin-edited, released with the server's. Builds without the subtitle limits keep the default.
 */
export const MINI_READS: string[] =
    typeof __LIMIT_SUBTITLE__ !== 'undefined' ? __LIMIT_SUBTITLE__.SUBTITLE_MINI_READS : ['ru', 'es'];
// Breaks ties within a tier: the more widespread first.
const PREVALENCE = ['ru', 'es', 'pt', 'fr', 'it', 'pl', 'uk', 'ar', 'hi', 'vi', 'he', 'cs', 'ro', 'el', 'th', 'bg', 'sr', 'hr', 'sk', 'lt', 'sl', 'lv'];
const CLUSTER: Record<string, string> = {
    ru: 'baltoslavic', uk: 'baltoslavic', pl: 'baltoslavic', cs: 'baltoslavic', sk: 'baltoslavic', sl: 'baltoslavic',
    sr: 'baltoslavic', hr: 'baltoslavic', bg: 'baltoslavic', lv: 'baltoslavic', lt: 'baltoslavic',
    es: 'romance', pt: 'romance', it: 'romance', fr: 'romance', ro: 'romance', el: 'romance',
    he: 'semitic', ar: 'semitic',
};

/** The target shows the gender of "I" or "you": its translation wants a second track. */
export function genderMarked(code: string): boolean {
    return GENDER_STRONG.includes(code) || GENDER_ADJECTIVE.includes(code);
}

// 1 best: the target itself, one the cheap model reads, strong, adjective-only, gender hidden.
function hintTier(target: string, lang: string): number {
    if (lang === target) return 1;
    if (MINI_READS.includes(lang)) return 2;
    if (GENDER_HIDDEN.includes(lang)) return 5;
    return GENDER_STRONG.includes(lang) ? 3 : 4;
}

/**
 * Orders a second track's language for a translation into `target`, lower
 * first (english repo, spec 025): by tier, then the target's cluster, then
 * prevalence. 0: no use. Mirrors dictionary-service subtitles.SecondRank.
 */
export function secondRank(target: string, lang: string): number {
    if (!genderMarked(target) || !genderMarked(lang)) return 0;
    const cluster = CLUSTER[target];
    return hintTier(target, lang) * 100 + PREVALENCE.indexOf(lang) + 1 + (cluster && CLUSTER[lang] === cluster ? 0 : 50);
}

/** A hint in `lang` is one the cheap model cannot read: the server sends it to its hint model. */
export function needsHintModel(target: string, lang: string): boolean {
    return lang !== target && !MINI_READS.includes(lang);
}

/** The whole order as text, one target a line: the parity test's subject. */
export function secondOrderTable(): string {
    const langs = [...GENDER_STRONG, ...GENDER_ADJECTIVE].sort();
    const lines = langs.map((t) => `${t}: ${[...langs].sort((a, b) => secondRank(t, a) - secondRank(t, b)).join(' ')}`);
    return `mini: ${MINI_READS.join(' ')}\n${lines.join('\n')}\n`;
}
