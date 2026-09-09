/**
 * `wordKey` — the address every saved word is stored under.
 *
 * Two implementations write to one collection: the Go backend and this
 * extension. If they disagree about a single codepoint, one word becomes two
 * documents, and no error is raised anywhere — the learner simply sees a word
 * they saved come back unsaved. That is why nothing here is asserted against a
 * description of the algorithm: the golden vectors carry the `key` column
 * produced by the reference implementation, and this suite only ever checks
 * against those literals.
 *
 * The vectors are loaded from a file rather than pasted in. A copy in this
 * repository could drift from the one the backend tests read, which is the
 * exact failure the shared file exists to prevent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Vector {
    in: string;
    display: string;
    normalized: string;
    /** null where the normalized form is empty: such a term has no key. */
    key: string | null;
}

const VECTORS_BASENAME = 'word-key-vectors.json';

/**
 * Where the vectors may live, in order.
 *
 * Deliberately NOT the limits loader's order: `LINGOGRAM_LIMITS_PATH` names the
 * limits *file* and cannot point here. And deliberately with **no built-in
 * defaults** — a fallback exists so a standalone checkout can build, and a
 * vector check that quietly falls back to something checks nothing at all. A
 * missing file must fail the suite and say where it looked.
 */
function vectorCandidates(): string[] {
    const fromEnv = process.env.LINGOGRAM_WORD_KEY_VECTORS_PATH;
    // The two sibling candidates are workspace siblings of this repository's
    // own parent, not of the repository: the extensions live under
    // workspace/chrome-extentions/, the backend directly under workspace/.
    const workspace = resolve(__dirname, '../../../../..');
    return [
        ...(fromEnv ? [fromEnv] : []),
        resolve(workspace, 'english-word-save/infrastructure', VECTORS_BASENAME),
        resolve(workspace, 'english/infrastructure', VECTORS_BASENAME),
    ];
}

function loadVectors(): Vector[] {
    const tried = vectorCandidates();
    const found = tried.find((p) => existsSync(p));
    if (!found) {
        throw new Error(
            `golden vectors not found. Set LINGOGRAM_WORD_KEY_VECTORS_PATH, or place ` +
            `${VECTORS_BASENAME} at one of:\n  ${tried.join('\n  ')}`,
        );
    }
    const parsed = JSON.parse(readFileSync(found, 'utf8')) as { vectors: Vector[] };
    if (!Array.isArray(parsed.vectors) || parsed.vectors.length === 0) {
        throw new Error(`${found} holds no vectors`);
    }
    return parsed.vectors;
}

const VECTORS = loadVectors();

import { __lower, displayForm, normalizeTerm, wordKey } from '../src/word-key';

describe('the golden vectors', () => {
    test('the file was found and carries vectors', () => {
        expect(VECTORS.length).toBeGreaterThan(0);
    });

    test.each(VECTORS)('displayForm($in)', (v) => {
        expect(displayForm(v.in)).toBe(v.display);
    });

    test.each(VECTORS)('normalizeTerm($in)', (v) => {
        expect(normalizeTerm(v.in)).toBe(v.normalized);
    });

    test.each(VECTORS)('wordKey($in)', (v) => {
        if (v.key === null) {
            // An empty normalized form has no key: the caller refuses the term
            // rather than hashing the empty string. A digest of "" is a
            // perfectly valid-looking 64 hex characters, which is precisely why
            // this must throw instead.
            expect(() => wordKey(v.in)).toThrow();
            return;
        }
        expect(wordKey(v.in)).toBe(v.key);
    });

    test('every key is 64 lowercase hex characters', () => {
        for (const v of VECTORS) {
            if (v.key === null) continue;
            expect(v.key).toMatch(/^[0-9a-f]{64}$/);
        }
    });
});

describe("the contract's own invariants, asserted over the same inputs", () => {
    // normalizeTerm(t) == NFC(lower(displayForm(t)))
    //
    // Written through the module's OWN `lower`, exposed as `__lower` — never
    // with a bare `toLowerCase()`, and never with a copy written out here.
    //
    // The bare host call is wrong for "İstanbul", and that divergence is what
    // the invariant exists to catch: asserting it through the call the
    // divergence lives in would assert nothing.
    //
    // A hand-written copy is wrong for a subtler reason, and this test used to
    // carry one. Measured: with the same single-pass defect applied to BOTH the
    // implementation and the copy, this invariant went silent — 3 failures
    // instead of 4, every one of them from the golden vectors. Two functions
    // written from one misreading agree with each other. A reference must come
    // from outside the head that wrote the implementation; here that is the
    // vector file, and this line's job is only to keep `normalizeTerm` and
    // `lower` consistent with each other.
    //
    // Required by contracts/word-key.md, "On reaching `lower` from a test".

    test.each(VECTORS)('normalizeTerm == NFC(lower(displayForm)) for $in', (v) => {
        expect(normalizeTerm(v.in)).toBe(__lower(displayForm(v.in)).normalize('NFC'));
    });

    // The property the second NFC in normalizeTerm exists to make true. Without
    // it, hashing a term read back from a document we ourselves wrote gives a
    // different key than hashing it the first time — one word, two documents,
    // arrived at by nothing but a second pass.
    test.each(VECTORS)('normalizeTerm is idempotent for $in', (v) => {
        const once = normalizeTerm(v.in);
        expect(normalizeTerm(once)).toBe(once);
    });

    test.each(VECTORS)('normalizeTerm output is already NFC for $in', (v) => {
        const once = normalizeTerm(v.in);
        expect(once.normalize('NFC')).toBe(once);
    });

    test('the same word in three shapes shares one key', () => {
        // The dotted-I collapse, stated as behaviour rather than as a table
        // row: the uppercase form, the decomposed form, and the form published
        // builds have already written all address one document.
        const shapes = ['İstanbul', 'İstanbul', 'i̇stanbul'];
        const keys = new Set(shapes.map((s) => wordKey(s)));
        expect(keys.size).toBe(1);
    });

    test('a term that normalizes to nothing is refused, not hashed', () => {
        for (const blank of ['', '   ', '\t\n', ' 　']) {
            expect(() => wordKey(blank)).toThrow();
        }
    });
});
