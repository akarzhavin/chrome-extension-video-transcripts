import { FEATURES } from '../config';

// Injected at document_start in the page's MAIN world (see manifest) so it wraps
// fetch/XHR BEFORE HDrezka requests the player data — that initial request is
// what carries the subtitle track list, and it fires before the isolated
// content script (document_idle) exists. Two jobs:
//   1) catch direct `.vtt` requests (the player lazy-loads a track when picked);
//   2) [autoSubtitleSearch] read the CDN data responses (movie / episode /
//      translation), which carry the FULL subtitle track list, so every language
//      loads automatically — no need to open the CC menu and select each by hand.
// Found URLs are buffered and re-delivered when the isolated content script
// signals readiness (VTT_SINK_READY), so nothing detected early is lost.
(function () {
    // The manifest matches <all_urls> to reach every rezka/hdrezka mirror
    // (rotating hash hosts, arbitrary TLDs) without a domain list, so guard here
    // before patching fetch/XHR — otherwise we'd wrap them on every site. Any
    // host containing "rezka" qualifies (this also covers "hdrezka"); in a frame
    // we check the ancestor chain so embedded players still match.
    const hostMatches = (h: string): boolean => h.includes('rezka');
    let onRezka = hostMatches(window.location.hostname);
    if (!onRezka && window.location.ancestorOrigins) {
        for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
            if (hostMatches(window.location.ancestorOrigins[i])) {
                onRezka = true;
                break;
            }
        }
    }
    if (!onRezka) return;

    // Absolute .vtt URLs, tolerant of trailing query/format chars. Slashes in
    // HDrezka's JSON are escaped (\/), so we normalize before matching.
    const VTT_RE = /https?:\/\/[^\s"'<>,\]\\]+\.vtt[^\s"'<>,\]\\]*/g;

    const buffer: string[] = [];
    const seen = new Set<string>();

    function emit(url: string): void {
        if (!url || seen.has(url)) return;
        seen.add(url);
        buffer.push(url);
        window.postMessage({ type: 'VTT_URL_DETECTED', url }, '*');
    }

    // Pull every .vtt URL out of a blob of text (inline config or JSON body).
    function scanBody(text: string): void {
        if (!text || text.indexOf('.vtt') === -1) return;
        const normalized = text.replace(/\\\//g, '/');
        VTT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = VTT_RE.exec(normalized)) !== null) emit(m[0]);
    }

    // Player CDN endpoints whose JSON carries the subtitle list.
    const isCdnDataUrl = (url: string): boolean => /get_cdn|cdn_|\/ajax\//i.test(url);

    const originalFetch = window.fetch;
    window.fetch = async function (...args: any[]) {
        const response = await originalFetch.apply(window, args as [RequestInfo | URL, RequestInit?]);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (url && url.includes('.vtt')) emit(url);
        // Auto-search: clone so reading the body doesn't consume it for the player.
        try {
            if (FEATURES.autoSubtitleSearch && url && isCdnDataUrl(String(url))) {
                response.clone().text().then(scanBody).catch(() => {});
            }
        } catch {
            /* ignore */
        }
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
        const url = args[1];
        if (typeof url === 'string') {
            if (url.includes('.vtt')) emit(url);
            if (FEATURES.autoSubtitleSearch && isCdnDataUrl(url)) {
                this.addEventListener('load', function (this: XMLHttpRequest) {
                    try {
                        scanBody(this.responseText);
                    } catch {
                        /* ignore */
                    }
                });
            }
        }
        return (originalOpen as any).apply(this, args);
    };

    // The isolated-world content script starts later (document_idle). When it
    // signals readiness, re-deliver everything found so far so URLs detected
    // before it was listening aren't lost.
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source === window && e.data && e.data.type === 'VTT_SINK_READY') {
            buffer.forEach((url) => window.postMessage({ type: 'VTT_URL_DETECTED', url }, '*'));
        }
    });
})();
