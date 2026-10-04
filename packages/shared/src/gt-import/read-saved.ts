// Reads the learner's saved phrases off translate.google.com/saved.
//
// Injected with chrome.scripting.executeScript, so `readGoogleSaved` must be
// self-contained: no imports, no closures over module scope. Everything it
// needs is declared inside its body.
//
// Measured on the live page (2026-10-03, a list of 334 phrases): the whole list
// is embedded in the HTML as one `AF_initDataCallback` blob whose rows are
//   [id, srcLang, dstLang, srcText, dstText, tsMicros, null, [1]]
// All rows are there at load; the paging in the panel is client-side. The blob
// is read rather than the cards because it needs no paging, and paging stalls
// while the tab is hidden (measured: timers and rendering are throttled).

export interface SavedPair {
    srcLang: string;
    srcText: string;
    dstLang: string;
    dstText: string;
}

export interface ReadResult {
    via: 'data' | 'none';
    pairs: SavedPair[];
}

export function readGoogleSaved(): ReadResult {
    // The timestamp is what tells a saved row from the page's other blobs: the
    // language list is also arrays of short strings, and on the live page it
    // comes first (measured: without this check the reader returned 2 "pairs"
    // like ["ach", "ab", "ace", ...] instead of the 334 saved phrases).
    const isPair = (r: unknown): r is [string, string, string, string, string, number] =>
        Array.isArray(r) &&
        r.length >= 6 &&
        typeof r[5] === 'number' &&
        typeof r[0] === 'string' &&
        typeof r[1] === 'string' &&
        typeof r[2] === 'string' &&
        typeof r[3] === 'string' &&
        typeof r[4] === 'string' &&
        /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(r[1]) &&
        /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(r[2]);

    // The key name ('ds:1' on the day it was measured) is not trusted: every
    // blob is parsed and the first array made entirely of rows of that shape
    // wins.
    const findRows = (node: unknown, depth: number): unknown[] | null => {
        if (!Array.isArray(node) || depth > 4) return null;
        if (node.length > 0 && node.every(isPair)) return node;
        for (const child of node) {
            const found = findRows(child, depth + 1);
            if (found) return found;
        }
        return null;
    };

    for (const script of Array.from(document.scripts)) {
        const text = script.textContent ?? '';
        if (!text.startsWith('AF_initDataCallback(')) continue;
        const m = text.match(/data:([\s\S]*), sideChannel:/);
        if (!m) continue;
        let data: unknown;
        try {
            data = JSON.parse(m[1]);
        } catch {
            continue;
        }
        const rows = findRows(data, 0);
        if (rows) {
            return {
                via: 'data',
                pairs: rows.map((r) => {
                    const row = r as string[];
                    return { srcLang: row[1], dstLang: row[2], srcText: row[3], dstText: row[4] };
                }),
            };
        }
    }

    // No card fallback on purpose: the cards hold one page of ten, and a
    // partial import that looks complete is worse than a clear failure.
    return { via: 'none', pairs: [] };
}
