// The account's limit on a term, in one place: the account writes enforce it
// and so does the signed-out save, so a word that fits here can be uploaded
// later instead of being dropped at sign-in.
//
// Firestore rules' string.size() counts UTF-8 bytes, not JS chars. Match the
// same units client-side so the friendly error stays in sync with what the
// server would reject.

// Injected at build time from infrastructure/lingogram-limits.json.
const MAX_TERM_BYTES = __LIMIT_MAX_TERM_BYTES__;

export function utf8Bytes(s: string): number {
    return new TextEncoder().encode(s).length;
}

/** Throws the account's "term must be" error when the term cannot be held. */
export function assertTermFits(term: string): void {
    const bytes = utf8Bytes(term);
    if (bytes === 0 || bytes > MAX_TERM_BYTES) {
        throw new Error(`term must be 1..${MAX_TERM_BYTES} bytes (UTF-8)`);
    }
}
