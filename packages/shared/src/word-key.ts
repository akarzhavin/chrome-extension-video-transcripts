// The address a saved word is stored under, and the two display/term forms that
// go into the document beside it.
//
// Implemented from contracts/word-key.md, section "Definition". Do not adjust
// anything here to make a test pass: the Go backend writes to the same
// collection, and any divergence produces two documents for one word with no
// error raised anywhere — the learner just sees a word they saved come back
// unsaved. The golden vectors are the arbiter.
//
//     wordKey(term)       = hex( sha256( utf8( normalizeTerm(term) ) ) )
//     displayForm(term)   = collapse( trim( NFC(term) ) )
//     normalizeTerm(term) = collapse( NFC( lower( trim( NFC(term) ) ) ) )
//
// Order matters: lowercasing before NFC gives a different result for some
// sequences, and trimming after collapsing would leave a leading space on an
// input that starts with a tab.

// The whitespace set, enumerated rather than written as a character class.
// `\s` and `trim()` each match a DIFFERENT set than this one — that is not a
// style preference: JavaScript's `trim()` strips U+FEFF and keeps U+0085, Go's
// `TrimSpace` does the opposite, and either mismatch is a second document for
// the same word. U+200B is deliberately absent: neither language calls it
// whitespace.
const WHITESPACE = new Set([
    '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020',
    '\u0085', '\u00A0', '\u1680',
    '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
    '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
    '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
]);

const isSpace = (ch: string): boolean => WHITESPACE.has(ch);

/** Strip leading and trailing whitespace — the contract's set, not `trim()`'s. */
function trimTerm(s: string): string {
    const chars = [...s];
    let start = 0;
    let end = chars.length;
    while (start < end && isSpace(chars[start])) start++;
    while (end > start && isSpace(chars[end - 1])) end--;
    return chars.slice(start, end).join('');
}

/** Every run of whitespace becomes one U+0020. Assumes a trimmed input. */
function collapse(s: string): string {
    const out: string[] = [];
    let inRun = false;
    for (const ch of s) {
        if (isSpace(ch)) {
            if (!inRun) {
                out.push(' ');
                inRun = true;
            }
            continue;
        }
        out.push(ch);
        inRun = false;
    }
    return out.join('');
}

/**
 * The contract's `lower`: the host's lowercase followed by BOTH substitutions.
 *
 * Neither language's bare lowercase is usable. Go applies simple case mapping;
 * JavaScript applies the full Unicode mapping, including the final-sigma rule
 * and the Turkish dotted-I expansion. The whole gap between them is two
 * codepoints, and these two substitutions close it — so the same function name
 * means the same function in both implementations.
 *
 * No pre-processing before the host call: `toLowerCase("İ")` yields
 * `i` + U+0307 and the second substitution collapses it.
 */
function lower(s: string): string {
    const lowered = s
        .toLowerCase()
        // Final sigma → plain sigma. JavaScript picks U+03C2 at a word's end,
        // Go never does.
        .replace(/ς/g, 'σ')
        // i + combining dot above → i, applied until it stops changing.
        //
        // The repetition is not defensive. A single pass leaves a dot behind on
        // an input carrying two of them in a row: replacing the first pair
        // brings the next mark up against the `i` and creates a match the same
        // pass has already gone past. `i` + U+0307 + U+0307 would key
        // differently from `i`, which the golden vectors catch.
        //
        // This also repairs what published builds already wrote: 1.0.20
        // lowercased bare, so a Turkish İ is stored today as i + U+0307, and
        // without this substitution converting such a document would address a
        // different key than a fresh capture of the same word.
        ;
    let out = lowered;
    for (;;) {
        const next = out.replace(/i̇/g, 'i');
        if (next === out) return out;
        out = next;
    }
}

/**
 * `lower`, reachable from a test. **Test-only — nothing outside a test may import it.**
 *
 * Required by contracts/word-key.md, section "On reaching `lower` from a test". The invariant
 * `normalizeTerm == NFC(lower(displayForm))` is deliberately written through THIS function so that
 * nobody assembles it out of a host `toLowerCase()` — which is the exact divergence the invariant
 * exists to trap. Go's test sits in the same package and sees the unexported function for free;
 * TypeScript has no equivalent, so it is published under a name that reads as internal.
 *
 * The alternative — a `contractLower` hand-written in the test from this contract — was measured
 * and rejected: with the same defect applied to both copies the invariant went SILENT (3 failures
 * instead of 4, all of them from the golden vectors). A reference re-derived by the same author in
 * the same sitting reproduces the same misreading. Absence of a defect in such a copy is a state,
 * not a property.
 *
 * Not part of the public surface: `word-key` is not re-exported from `src/index.ts`, so this stays
 * inside the package.
 */
export const __lower = lower;

/**
 * What goes in the document's `display` field.
 *
 * Not "whatever the page handed us": raw DOM text carries tabs between the
 * spans of a phrase, non-breaking spaces from subtitle markup, and the odd BOM,
 * and none of that belongs in a permanent record.
 */
export function displayForm(term: string): string {
    return collapse(trimTerm(term.normalize('NFC')));
}

/**
 * What goes in `term`, and what the key hashes.
 *
 * The second NFC — after `lower` — is not belt-and-braces. Three inputs
 * (İ, Ϊ, Ϋ each followed by an acute) lowercase into a sequence that has a
 * precomposed equivalent, so without it a second pass over an already-stored
 * term produces a different key. And a second pass is structural: the site
 * hashes the `term` it reads back out of a document, which is this function's
 * own output.
 */
export function normalizeTerm(term: string): string {
    return collapse(lower(trimTerm(term.normalize('NFC'))).normalize('NFC'));
}

/** Lowercase hex of the digest. */
function toHex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

/**
 * The document address: 64 lowercase hex characters.
 *
 * Throws on a term that normalizes to nothing. That is the contract's rule and
 * not a defensive nicety — sha256("") is a perfectly valid-looking digest, so
 * hashing the empty string would file every blank capture under one shared,
 * plausible address instead of refusing it.
 *
 * Synchronous, because both callers decide what to paint while building a
 * frame. `crypto.subtle` is async and cannot be used here; this is the reason
 * the mirror is keyed by the normalized term rather than by this value.
 */
export function wordKey(term: string): string {
    const normalized = normalizeTerm(term);
    if (!normalized) throw new Error('wordKey: term normalizes to the empty string');
    return toHex(sha256(new TextEncoder().encode(normalized)));
}

// --- sha256 -----------------------------------------------------------------
//
// Written out rather than pulled from a dependency or from crypto.subtle: the
// render path needs a synchronous answer (subtle is Promise-only), and a
// content script must not carry a hashing library into every page it runs on.
// FIPS 180-4; the constants are the standard's own.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

function sha256(message: Uint8Array): Uint8Array {
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);

    // Pad: 0x80, zeros, then the length in bits as a 64-bit big-endian integer.
    //
    // The size is ceil((len + 9) / 64) blocks — one byte for the 0x80 marker
    // and eight for the length. Written with `>> 6` plus a `+ 1` it is wrong
    // for exactly the lengths where len % 64 == 55, where 55 + 9 fills a block
    // precisely: the shift already accounted for it and the extra block pushed
    // the length field past where the algorithm reads it. Those inputs hashed
    // to a plausible, wrong digest — a word of that length would have been
    // stored at an address the rules refuse and the Go implementation does not
    // share.
    const bitLen = message.length * 8;
    const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
    padded.set(message);
    padded[message.length] = 0x80;
    const view = new DataView(padded.buffer);
    // Lengths past 2^32 bits cannot arise here (a term is a word or a phrase),
    // so the high word is left zero rather than carrying float arithmetic.
    view.setUint32(padded.length - 4, bitLen >>> 0, false);

    const w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e;
            e = (d + t1) >>> 0;
            d = c; c = b; b = a;
            a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
    return out;
}
