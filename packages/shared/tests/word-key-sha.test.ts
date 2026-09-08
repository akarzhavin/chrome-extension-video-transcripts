/**
 * The digest itself, against an independent implementation.
 *
 * The golden vectors prove that this build agrees with the Go one on the terms
 * they list — and every one of those normalizes to between 1 and 17 bytes, so
 * all 28 of them exercise a single padding branch. A sha256 that is wrong only
 * for longer inputs passes all 172 of those assertions and still hands the
 * wrong address to a phrase of ordinary length.
 *
 * That is not hypothetical: the first version of this file sized its padding
 * buffer with `(((len + 9) >> 6) + 1) << 6`, which allocates one block too many
 * whenever `len % 64 == 55` and writes the length field past where the
 * algorithm reads it. Lengths 55, 119 and 183 hashed to a plausible, wrong
 * digest. A phrase like "get something off the ground before it is too late
 * okay" is exactly 55 bytes.
 *
 * `node:crypto` is the second implementation this check needs. It is not
 * available in the extension — the render path is synchronous and a content
 * script must not carry a hashing library — but in a test it is precisely the
 * outside authority the vectors cannot be.
 */

import { createHash } from 'node:crypto';
import { wordKey } from '../src/word-key';

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('the digest matches an independent sha256', () => {
    // Every branch of the padding: a block that fits the marker and the length,
    // one where they spill into a second block, and the exact boundaries in
    // between. 55, 119 and 183 are the ones that were wrong.
    const BOUNDARIES = [1, 54, 55, 56, 63, 64, 65, 111, 118, 119, 120, 127, 128, 182, 183, 184];

    test.each(BOUNDARIES)('a term of %i bytes hashes to the same digest', (n) => {
        const term = 'a'.repeat(n);
        expect(wordKey(term)).toBe(sha256Hex(term));
    });

    test('every length from 1 to 200 agrees', () => {
        const mismatched: number[] = [];
        for (let n = 1; n <= 200; n++) {
            const term = 'a'.repeat(n);
            if (wordKey(term) !== sha256Hex(term)) mismatched.push(n);
        }
        expect(mismatched).toEqual([]);
    });

    test('multi-byte characters are hashed as UTF-8 bytes, not as code units', () => {
        // A term whose byte length differs from its length in JS characters —
        // the padding is computed in bytes, and a length taken from `.length`
        // would land in a different block for the same string.
        for (const term of ['кот', '日本語のことば', 'ß'.repeat(30), '🙂'.repeat(20)]) {
            expect(wordKey(term)).toBe(sha256Hex(term.normalize('NFC').toLowerCase()));
        }
    });
});
