// Which streaming site is this page? The extension ships one content script
// pair for both youtube.com and netflix.com (see manifest.json), so both the
// MAIN-world hook and the isolated bootstrap have to branch on the host.
//
// Match the registrable domain and its subdomains, never a bare substring:
// `hostname.includes('netflix.com')` is also true for `netflix.com.example`,
// which is an attacker-controlled host, not Netflix. The manifest's `matches`
// already constrains where these scripts run, so this isn't exploitable today —
// it's a correctness guard that costs nothing and stops the check from being
// wrong if the script is ever loaded somewhere new.
function isHost(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith('.' + domain);
}

export function isNetflix(hostname: string = location.hostname): boolean {
    return isHost(hostname, 'netflix.com');
}

export function isYouTube(hostname: string = location.hostname): boolean {
    return isHost(hostname, 'youtube.com');
}
