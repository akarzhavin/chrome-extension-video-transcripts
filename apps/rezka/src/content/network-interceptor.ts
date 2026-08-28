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

    // The `subtitle` field of a CDN data response lists the tracks as
    // "[Label]url,[Label]url" — the label is the player's own name for the
    // track ("Русские", "Оригинал (+субтитры) (реж.)"). It is the ONLY thing
    // that distinguishes two tracks in the same language: a director's-cut
    // track and the theatrical one are both Russian, and guessing a name from
    // the text of the cues cannot tell them apart. Capture it here, at the one
    // point where the pairing exists, because nothing downstream can recover it.
    const LABELLED_VTT_RE =
        /\[([^\]]*)\]\s*(https?:\/\/[^\s"'<>,\]\\]+\.vtt[^\s"'<>,\]\\]*)/g;

    interface Found {
        url: string;
        label?: string;
    }

    const buffer: Found[] = [];
    const seen = new Map<string, Found>();

    function emit(url: string, label?: string): void {
        if (!url) return;
        const known = seen.get(url);
        // A URL can surface twice: once bare (the player fetching it) and once
        // labelled (the CDN listing). Re-announce it when the label is new, so
        // whichever arrives second still gets the name attached.
        if (known && (!label || known.label === label)) return;
        const found: Found = { url, label: label || known?.label };
        seen.set(url, found);
        if (!known) buffer.push(found);
        else buffer[buffer.indexOf(known)] = found;
        window.postMessage({ type: 'VTT_URL_DETECTED', url, label: found.label }, '*');
    }

    // Labels arrive as JSON \uXXXX escapes ("\u0420\u0443\u0441..."), because we
    // scan the RAW response text — the parse that would decode them belongs to
    // the player, not to us. Left as-is they reach the UI verbatim, so decode
    // them here. Only \uXXXX: the surrounding text is not JSON, so anything
    // heavier would be guessing at escapes we never produced.
    function decodeEscapes(text: string): string {
        return text.replace(/\\u([0-9a-fA-F]{4})/g,
            (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }

    // Pull every .vtt URL out of a blob of text (inline config or JSON body).
    function scanBody(text: string): void {
        if (!text || text.indexOf('.vtt') === -1) return;
        const normalized = text.replace(/\\\//g, '/');
        // Labelled pass first, so a track's name is known before the bare pass
        // sees the same URL.
        LABELLED_VTT_RE.lastIndex = 0;
        let labelled: RegExpExecArray | null;
        while ((labelled = LABELLED_VTT_RE.exec(normalized)) !== null) {
            emit(labelled[2], decodeEscapes(labelled[1]).trim());
        }
        VTT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = VTT_RE.exec(normalized)) !== null) emit(m[0]);
    }

    // Player CDN endpoints whose JSON carries the subtitle list.
    const isCdnDataUrl = (url: string): boolean => /get_cdn|cdn_|\/ajax\//i.test(url);

    // Switching translator ("Оригинал (+субтитры)" -> the same with "(реж.)")
    // is an AJAX call on the same page: a new listing arrives and the previous
    // tracks stop applying. Announce that so the isolated world can drop them —
    // otherwise the new tracks pile up behind the old ones and the panel keeps
    // showing the version the user just switched away from, at the wrong timing.
    //
    // Keyed off the RESPONSE rather than a click on the translator menu: the
    // response is what actually carries the new list, and it does not depend on
    // HDrezka's markup. get_cdn_tiles is excluded — those are the thumbnail
    // sprite sheets, they match the endpoint pattern above and fire constantly.
    function announceNewTrackSet(url: string, text: string): void {
        if (/get_cdn_tiles/i.test(url)) return;
        if (!text || text.indexOf('.vtt') === -1) return;
        window.postMessage({ type: 'VTT_TRACKS_RESET' }, '*');
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args: any[]) {
        const response = await originalFetch.apply(window, args as [RequestInfo | URL, RequestInit?]);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (url && url.includes('.vtt')) emit(url);
        // Auto-search: clone so reading the body doesn't consume it for the player.
        try {
            if (FEATURES.autoSubtitleSearch && url && isCdnDataUrl(String(url))) {
                response.clone().text().then((text) => {
                    // Order matters: the reset has to reach the isolated world
                    // before the tracks it is meant to precede.
                    announceNewTrackSet(String(url), text);
                    scanBody(text);
                }).catch(() => {});
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
                        announceNewTrackSet(url, this.responseText);
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
            buffer.forEach(({ url, label }) =>
                window.postMessage({ type: 'VTT_URL_DETECTED', url, label }, '*'));
        }
    });
})();
