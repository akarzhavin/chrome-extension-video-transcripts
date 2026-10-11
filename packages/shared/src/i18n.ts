// Tiny i18n helper for content-script UI. Resolves a message via chrome.i18n in
// the user's UI locale, with an optional override map consulted first. The promo
// demo installs an override for the screenshot locale, so captured UI localizes
// regardless of Chrome's extension-UI language (which --lang does not change).
let overrides: Record<string, string> | null = null;

/** Install (or clear with null) a key→string override consulted before chrome.i18n. */
export function setI18nOverride(map: Record<string, string> | null): void {
    overrides = map;
}

// Chrome only fills $1.. itself for its own messages; overrides and fallbacks need the same.
const fill = (text: string, subs?: string[]): string =>
    subs ? text.replace(/\$(\d)/g, (_, n) => subs[Number(n) - 1] ?? '') : text;

/** Localized message for `key`, falling back to chrome.i18n, then `fallback`; `subs` fill $1, $2... */
export function msg(key: string, fallback: string, subs?: string[]): string {
    if (overrides && overrides[key]) return fill(overrides[key], subs);
    try {
        if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
            const got = subs ? chrome.i18n.getMessage(key, subs) : chrome.i18n.getMessage(key);
            if (got) return got;
        }
    } catch {
        /* not running in an extension context */
    }
    return fill(fallback, subs);
}
