// Which sites the page highlight is switched off on. The one place that decides
// what "the same site" means, used by the popup (the per-site switch), the
// settings page (the list) and the page-highlight content script (the check).

/**
 * The key a site is listed under: the hostname, lower-cased, without a leading
 * `www.`. Exact otherwise: `news.bbc.co.uk` and `bbc.co.uk` are two sites.
 */
export function normalizeHost(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^www\./, '');
}

/** Whether `hostname` is on the list of hosts highlighting is off on. */
export function isHighlightOff(offHosts: readonly string[], hostname: string): boolean {
    return offHosts.includes(normalizeHost(hostname));
}

/** The list with `hostname` added (once) or removed. Never mutates `offHosts`. */
export function withHighlight(offHosts: readonly string[], hostname: string, on: boolean): string[] {
    const host = normalizeHost(hostname);
    const rest = offHosts.filter((h) => h !== host);
    return on ? rest : [...rest, host];
}

/**
 * The manifest's `exclude_matches` for the page-highlight content script:
 * Lingogram's own site, where it does not run.
 */
function isOwnSite(url: URL): boolean {
    return url.protocol === 'https:' && (url.hostname === 'lingogram.ai' || url.hostname.endsWith('.lingogram.ai'));
}

/**
 * The hostname the per-site switch is about, or null where there is no such
 * switch: not an http(s) page, no URL at all, or Lingogram's own site.
 */
export function highlightSiteOf(url: string | undefined): string | null {
    if (!url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isOwnSite(parsed)) return null;
    return normalizeHost(parsed.hostname) || null;
}
