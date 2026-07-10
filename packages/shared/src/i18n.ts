// Tiny i18n helper for content-script UI. Resolves a message via chrome.i18n in
// the user's UI locale, with an optional override map consulted first. The promo
// demo installs an override for the screenshot locale, so captured UI localizes
// regardless of Chrome's extension-UI language (which --lang does not change).
let overrides: Record<string, string> | null = null;

/** Install (or clear with null) a key→string override consulted before chrome.i18n. */
export function setI18nOverride(map: Record<string, string> | null): void {
    overrides = map;
}

/** Localized message for `key`, falling back to chrome.i18n, then `fallback`. */
export function msg(key: string, fallback: string): string {
    if (overrides && overrides[key]) return overrides[key];
    try {
        if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
            return chrome.i18n.getMessage(key) || fallback;
        }
    } catch {
        /* not running in an extension context */
    }
    return fallback;
}
