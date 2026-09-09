/**
 * @jest-environment jsdom
 *
 * What a saved word carries — and, more importantly, what it does not.
 *
 * Behaviour map §14.2, §14.3, §14.4, §14.8, §14.10. This module decides what
 * leaves the device when someone saves a word, enforces the daily cap and the
 * length limits, and mints the document id. It had no tests at all.
 *
 * The privacy claim is the reason this file exists: the map states that the
 * video's address, its title and the chosen language pair are never recorded.
 * Nothing checked that, so adding a `videoRef` "for debugging" would have been
 * a one-line change nobody could have caught.
 *
 * buildWrites is private, so everything here goes through the exported
 * addInboxWord with fetch mocked and the request body read back — which also
 * means these checks cover the real call path rather than a helper's.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return Promise.resolve(out);
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(store, items);
                return Promise.resolve();
            }),
            remove: jest.fn(() => Promise.resolve()),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    runtime: { id: 'test-extension-id' },
};

import { existsSync as nodeExists, readFileSync as nodeRead } from 'node:fs';
import { resolve as nodeResolve } from 'node:path';
import { addInboxWord, removeInboxWord } from '../src/auth/firestoreRest';
import { displayForm, normalizeTerm, wordKey } from '../src/word-key';
import type { AuthConfig } from '../src/auth/config';

const MAX_TERM_BYTES = (global as any).__LIMIT_MAX_TERM_BYTES__ as number;
const MAX_CONTEXT_BYTES = (global as any).__LIMIT_MAX_CONTEXT_BYTES__ as number;
const MAX_WORDS_PER_DAY = (global as any).__LIMIT_MAX_WORDS_PER_DAY__ as number;

const cfg: AuthConfig = {
    env: 'dev',
    projectId: 'demo-lingogram',
    apiKey: 'demo',
    identityToolkitUrl: 'http://localhost:9099/identitytoolkit.googleapis.com',
    secureTokenUrl: 'http://localhost:9099/securetoken.googleapis.com',
    firestoreUrl: 'http://localhost:8080',
    frontendBaseUrl: 'http://localhost:5173',
    apiBaseUrl: 'https://api.test',
    source: 'youtube-extension',
} as AuthConfig;

/** The bucket the module computes for "today", so the cap can be primed. */
const todayBucket = (): number => {
    const d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

let commits: Array<Record<string, any>>;
let sentinelDoc: { status: number; body?: unknown };

function signedIn(): void {
    store['auth.idToken'] = 'token';
    store['auth.refreshToken'] = 'refresh';
    store['auth.expiresAt'] = Date.now() + 3_600_000;
    store['auth.email'] = 'someone@example.com';
    store['auth.uid'] = 'uid-1';
}

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    signedIn();
    commits = [];
    sentinelDoc = { status: 404 };
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes(':commit')) {
            commits.push(JSON.parse(String(init?.body ?? '{}')));
            return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }), text: async () => '' } as any;
        }
        // the sentinel read
        return {
            ok: sentinelDoc.status === 200,
            status: sentinelDoc.status,
            json: async () => sentinelDoc.body ?? {},
            text: async () => '',
        } as any;
    });
});

/** The word document's fields out of the last commit. */
const wordFields = (): Record<string, any> => {
    const w = commits[0].writes.find((x: any) => x.update?.name?.includes('/words/'));
    return w.update.fields;
};
const wordWrite = (): Record<string, any> =>
    commits[0].writes.find((x: any) => x.update?.name?.includes('/words/'));

/** Prime the daily counter to `count` words already saved today. */
function sentinelAt(count: number): void {
    sentinelDoc = {
        status: 200,
        body: { fields: { dayBucket: { integerValue: String(todayBucket()) }, dailyCount: { integerValue: String(count) } } },
    };
}

describe('what a saved word carries', () => {
    test('exactly the durable field set, and no more', async () => {
        // The durable shape adds `display` (the form the learner saw, kept
        // because `term` is now normalized and no longer resembles what was on
        // screen) and `state` (what removal toggles), and it DROPS `processed`.
        //
        // `processed` is not a leftover: it belonged to the legacy
        // import-and-delete flow, and the durable rule's allowlist does not
        // name it — a body carrying it is refused outright, so keeping it would
        // have meant the extension could not save a single word. Measured on
        // the emulator: the same body with and without it, refused and
        // accepted. addedAt/updatedAt are not here either — they travel as
        // transforms.
        await addInboxWord(cfg, { term: 'ephemeral', context: 'a b c' });
        expect(Object.keys(wordFields()).sort())
            .toEqual(['context', 'display', 'source', 'state', 'term']);
    });

    test('nothing identifies the video, the page or the language pair', async () => {
        // The single most valuable assertion here. The map promises this and
        // the policy rests on it; a field added "for debugging" would ship.
        await addInboxWord(cfg, { term: 'ephemeral', context: 'a b c' });
        const body = JSON.stringify(commits[0]);
        for (const leak of ['videoRef', 'videoId', 'title', 'url', 'learning', 'native', 'watch?v=']) {
            expect(body).not.toContain(leak);
        }
    });

    test('the term is stored normalized, and the display form beside it', async () => {
        // INVERTED by cycle D, and deliberately: `term` is what the key hashes,
        // so it has to be the normalized form or two clients would address one
        // word differently. What the learner actually saw is preserved in
        // `display`, which is why nothing is lost by normalizing here.
        await addInboxWord(cfg, { term: 'Ephemeral' });
        expect(wordFields().term).toEqual({ stringValue: normalizeTerm('Ephemeral') });
        expect(wordFields().display).toEqual({ stringValue: displayForm('Ephemeral') });
    });

    test('the edition is recorded', async () => {
        await addInboxWord(cfg, { term: 'x' });
        expect(wordFields().source).toEqual({ stringValue: 'youtube-extension' });
    });

    test('the time comes from the server, never the device', async () => {
        // A device clock drifts; the rule the write must satisfy compares
        // against the server's own request time.
        await addInboxWord(cfg, { term: 'x' });
        // Both stamps come from the server now: a create sets addedAt and
        // updatedAt together, so a document's first version is not left with an
        // updatedAt the rules would compare against nothing.
        expect(wordWrite().updateTransforms).toEqual([
            { fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ]);
        expect(JSON.stringify(wordFields())).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    test('a word saved with no context sends no empty context', async () => {
        await addInboxWord(cfg, { term: 'x' });
        expect(wordFields()).not.toHaveProperty('context');
    });

    test('saving the same word twice addresses ONE document', async () => {
        // INVERTED by cycle D. The old shape gave every save a fresh random id,
        // so one word became as many documents as times it was met — which is
        // exactly what made a saved word unrecognisable on the next page. The
        // id is now the wordKey, so the second save reaches the first
        // document; the rules refuse the create form and the client retries as
        // a re-activation (cycle E).
        const a = await addInboxWord(cfg, { term: 'same' });
        const b = await addInboxWord(cfg, { term: 'same' });
        expect(a.wordId).toEqual(b.wordId);
        expect(a.wordId).toBe(wordKey('same'));
        expect(commits).toHaveLength(2);
    });
});

describe('the limits a save enforces', () => {
    test('an empty term is refused before anything is sent', async () => {
        await expect(addInboxWord(cfg, { term: '' })).rejects.toThrow(/1\.\./);
        expect(commits).toHaveLength(0);
    });

    test('a term at the limit is accepted, one byte over is refused', async () => {
        await addInboxWord(cfg, { term: 'a'.repeat(MAX_TERM_BYTES) });
        expect(commits).toHaveLength(1);
        await expect(addInboxWord(cfg, { term: 'a'.repeat(MAX_TERM_BYTES + 1) })).rejects.toThrow();
        expect(commits).toHaveLength(1);
    });

    test('an over-long context is trimmed from the end, not the start', async () => {
        // The saved word sits in the middle line of the context window, so the
        // end is what may be lost.
        const context = 'START' + 'x'.repeat(MAX_CONTEXT_BYTES);
        await addInboxWord(cfg, { term: 'x', context });
        const sent = wordFields().context.stringValue as string;
        expect(Buffer.byteLength(sent, 'utf8')).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
        expect(sent.startsWith('START')).toBe(true);
    });

    test('the day\'s last word is accepted and the next is refused by name', async () => {
        sentinelAt(MAX_WORDS_PER_DAY - 1);
        await addInboxWord(cfg, { term: 'last' });
        expect(commits).toHaveLength(1);

        sentinelAt(MAX_WORDS_PER_DAY);
        await expect(addInboxWord(cfg, { term: 'one too many' })).rejects.toThrow(
            new RegExp(`Daily limit of ${MAX_WORDS_PER_DAY} words`),
        );
        expect(commits).toHaveLength(1);
    });

    test('yesterday\'s count does not carry into today', async () => {
        sentinelDoc = {
            status: 200,
            body: { fields: { dayBucket: { integerValue: String(todayBucket() - 1) }, dailyCount: { integerValue: String(MAX_WORDS_PER_DAY) } } },
        };
        await addInboxWord(cfg, { term: 'fresh day' });
        expect(commits).toHaveLength(1);
    });

    test('nothing is sent when nobody is signed in', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        await expect(addInboxWord(cfg, { term: 'x' })).rejects.toThrow(/Not signed in/);
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});

// --- Cycle D: the two activation forms, and removal ------------------------
//
// Assertions here come from two artefacts and nothing else: the input→body
// relations below, which follow from the caller's own arguments, and — added by
// T037 — a comparison against the captured fixture. Never from a field list
// retyped out of the contract, which would be the same paraphrase in a
// different syntax.

/** The sentinel write out of the last commit, or undefined when none was sent. */
const sentinelWrite = (): Record<string, any> | undefined =>
    commits[0].writes.find((x: any) => x.update?.name && !x.update.name.includes('/words/'));

describe('the durable create form', () => {
    test('the id is the wordKey of the term, not a random string', async () => {
        // Pinned to the vector's own function, so a key that drifts is caught.
        // "64 lowercase hex characters" would pass a completely different id.
        await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' });
        const name = wordWrite().update.name as string;
        expect(name.split('/').pop()).toBe(wordKey('Ephemeral'));
    });

    test('display is displayForm of the term, not the raw selection', async () => {
        // Raw DOM text carries tabs between the spans of a phrase and NBSPs
        // from subtitle markup; none of that belongs in a permanent document.
        await addInboxWord(cfg, { term: '  give\tup  ', context: 'a b c' });
        expect(wordFields().display).toEqual({ stringValue: displayForm('  give\tup  ') });
    });

    test('context is exactly what the caller passed', async () => {
        await addInboxWord(cfg, { term: 'x', context: 'the quick brown fox' });
        expect(wordFields().context).toEqual({ stringValue: 'the quick brown fox' });
    });

    test('the mask names exactly the fields written', async () => {
        // A commit with no mask is a full REPLACE. The rules cannot catch the
        // dangerous form of that — a replace resending every immutable field at
        // its stored value passes every condition — so the mask is a
        // client-side discipline and has to be asserted here.
        await addInboxWord(cfg, { term: 'x', context: 'a b c' });
        const w = wordWrite();
        expect(w.updateMask?.fieldPaths).toBeDefined();
        // "Exactly the fields written" includes the ones written by transform:
        // addedAt and updatedAt carry no value in `fields`, but they are set by
        // this commit and a mask that omitted them would leave them outside the
        // merge. So the mask is the union of both, and nothing else.
        const written = [...Object.keys(w.update.fields), ...w.updateTransforms.map((t: any) => t.fieldPath)];
        expect([...w.updateMask.fieldPaths].sort()).toEqual(written.sort());
    });

    test('the create form keeps its precondition', async () => {
        // Kept, not removed: it is what makes the seam work. A device that has
        // never synced uses this form, the server refuses it because the
        // document exists, and the client retries with re-activation.
        await addInboxWord(cfg, { term: 'x' });
        expect(wordWrite().currentDocument).toEqual({ exists: false });
    });

    test('a create pairs the word with the sentinel increment in one commit', async () => {
        await addInboxWord(cfg, { term: 'x' });
        expect(commits).toHaveLength(1);
        expect(commits[0].writes).toHaveLength(2);
        expect(sentinelWrite()).toBeDefined();
    });
});

describe('the re-activation form', () => {
    test('re-saving a removed word sends state and updatedAt, and nothing else', async () => {
        await addInboxWord(cfg, { term: 'x', context: 'a b c' }, { reactivate: true });
        const w = wordWrite();
        expect([...w.updateMask.fieldPaths].sort()).toEqual(['state', 'updatedAt']);
        // The FIELDS too, not only the mask. A stray field in the body is
        // exactly how `processed` reached the create form and made every save
        // refused; the mask alone would not have caught it there and does not
        // here. `updatedAt` is absent from this list because it travels as a
        // transform — see the mask above, which names both.
        expect(Object.keys(wordFields()).sort()).toEqual(['state']);
    });

    test('it sends no addedAt transform — the immutable fields are never touched', async () => {
        await addInboxWord(cfg, { term: 'x' }, { reactivate: true });
        const paths = (wordWrite().updateTransforms ?? []).map((t: any) => t.fieldPath);
        expect(paths).not.toContain('addedAt');
    });

    test('it carries no create precondition', async () => {
        await addInboxWord(cfg, { term: 'x' }, { reactivate: true });
        expect(wordWrite().currentDocument?.exists).not.toBe(false);
    });

    test('re-saving a removed word still emits the sentinel increment', async () => {
        // dailyCount counts ACTIVATIONS, and a re-activation is one.
        await addInboxWord(cfg, { term: 'x' }, { reactivate: true });
        expect(sentinelWrite()).toBeDefined();
    });
});

describe('removal', () => {
    test('one write, and no sentinel', async () => {
        // A removal costs nothing and carries no rate condition. An
        // implementation that fetches the sentinel to remove a word has copied
        // the activation path too closely.
        await removeInboxWord(cfg, { term: 'x' });
        expect(commits).toHaveLength(1);
        expect(commits[0].writes).toHaveLength(1);
        expect(sentinelWrite()).toBeUndefined();
    });

    test('it is masked to state and updatedAt, and carries nothing else', async () => {
        await removeInboxWord(cfg, { term: 'x' });
        expect([...wordWrite().updateMask.fieldPaths].sort()).toEqual(['state', 'updatedAt']);
        expect(wordFields().state).toEqual({ stringValue: 'removed' });
        // Same reason as the re-activation form above: the field set is pinned
        // independently of the mask, because a body can carry a field the mask
        // never names and be refused for it.
        expect(Object.keys(wordFields()).sort()).toEqual(['state']);
    });

    test('it addresses the same document a save would', async () => {
        await removeInboxWord(cfg, { term: 'Ephemeral' });
        expect((wordWrite().update.name as string).split('/').pop()).toBe(wordKey('Ephemeral'));
    });
});

describe('the daily cap, against the literal limit', () => {
    // Asserted against 500 rather than against the constant the module reads:
    // a test written in terms of the same symbol it is checking moves with it
    // and would stay green if the limit were changed by accident.
    test('the 500th activation of the day is accepted and the 501st is refused', async () => {
        sentinelAt(499);
        await addInboxWord(cfg, { term: 'five hundredth' });
        expect(commits).toHaveLength(1);

        sentinelAt(500);
        await expect(addInboxWord(cfg, { term: 'one too many' })).rejects.toThrow(/500/);
        expect(commits).toHaveLength(1);
    });

    test('a removal is not capped — it spends no allowance', async () => {
        sentinelAt(500);
        await removeInboxWord(cfg, { term: 'x' });
        expect(commits).toHaveLength(1);
    });
});

// --- T037: the captured bodies, replayed --------------------------------
//
// The relations above are derived from the caller's own arguments and would
// still hold if the body's SHAPE drifted — a field quietly added, a mask
// quietly widened. This block is what holds the shape: it replays what a real
// run produced and compares byte for byte, normalising only the values that
// cannot be deterministic.
//
// The fixture lives in the backend repository beside the golden vectors,
// because the rules tests replay the same file. Resolution mirrors the vector
// loader's, and there is deliberately NO fallback: a fixture comparison that
// silently skips when the file is missing compares nothing.

const FIXTURES_BASENAME = 'commit-body-fixtures.json';

function fixturePath(): string | undefined {
    const fromEnv = process.env.LINGOGRAM_COMMIT_FIXTURES_PATH;
    const workspace = nodeResolve(__dirname, '../../../../..');
    const tried = [
        ...(fromEnv ? [fromEnv] : []),
        nodeResolve(workspace, 'english-word-save/infrastructure', FIXTURES_BASENAME),
        nodeResolve(workspace, 'english/infrastructure', FIXTURES_BASENAME),
    ];
    return tried.find((p) => nodeExists(p));
}

/**
 * Replace what cannot be deterministic, and nothing else.
 *
 * Exactly three things move: the projectId/uid prefix, the word id, and the
 * sentinel's two counters. Normalising anything further would let a real drift
 * through — the whole point of pinning a captured body.
 */
function normalizeBody(commit: any, uid: string, key: string): any {
    let s = JSON.stringify(commit);
    s = s.split(`projects/${cfg.projectId}/databases/(default)/documents/inbox/${uid}`).join('{base}');
    if (key !== '{wordKey}') s = s.split(key).join('{wordKey}');
    const body = JSON.parse(s);
    for (const w of body.writes) {
        const f = w.update?.fields;
        if (f?.dailyCount) f.dailyCount = { integerValue: '{dailyCount}' };
        if (f?.dayBucket) f.dayBucket = { integerValue: '{dayBucket}' };
    }
    return body;
}

const found = fixturePath();
const describeFixture = found ? describe : describe.skip;
if (!found) {
    // Not silent: a skipped comparison must announce itself, or a missing file
    // looks exactly like a passing check.
    // eslint-disable-next-line no-console
    console.warn(`[T037] ${FIXTURES_BASENAME} not found — fixture comparison skipped, NOT passed.`);
}

describeFixture('the captured bodies still match what this build sends', () => {
    const fixture = found ? JSON.parse(nodeRead(found, 'utf8')) : { };

    // The fixture stores the captured values verbatim, so the SAME
    // normalisation is applied to both sides. Normalising only the run would
    // compare "{dayBucket}" against 20260907 and fail every day but the one the
    // capture was taken on — which is exactly the trap T049 warns about: the
    // bucket looks like a constant and expires at midnight.
    const stripMeta = (entry: any): any =>
        normalizeBody({ writes: entry.writes }, '{uid}', '{wordKey}');

    test('durableCreate', async () => {
        // THROW, not return, and not a console warning either. A test that
        // returns early is reported as PASSED and a warning in a log of
        // ~2000 tests changes no exit code — so a fixture rebuilt without
        // this entry would delete the comparison silently, which is the one
        // failure this pin exists to prevent.
        if (!fixture.durableCreate) {
            throw new Error(
                `[T037] ${FIXTURES_BASENAME} has no "durableCreate" entry — the comparison did not run. `
                + 'Re-capture it (see T037) rather than removing this test.',
            );
        }
        await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' });
        expect(normalizeBody(commits[0], 'uid-1', wordKey('Ephemeral')))
            .toEqual(stripMeta(fixture.durableCreate));
    });

    test('reactivation', async () => {
        // THROW, not return, and not a console warning either. A test that
        // returns early is reported as PASSED and a warning in a log of
        // ~2000 tests changes no exit code — so a fixture rebuilt without
        // this entry would delete the comparison silently, which is the one
        // failure this pin exists to prevent.
        if (!fixture.reactivation) {
            throw new Error(
                `[T037] ${FIXTURES_BASENAME} has no "reactivation" entry — the comparison did not run. `
                + 'Re-capture it (see T037) rather than removing this test.',
            );
        }
        await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' }, { reactivate: true });
        expect(normalizeBody(commits[0], 'uid-1', wordKey('Ephemeral')))
            .toEqual(stripMeta(fixture.reactivation));
    });

    test('removal', async () => {
        // THROW, not return, and not a console warning either. A test that
        // returns early is reported as PASSED and a warning in a log of
        // ~2000 tests changes no exit code — so a fixture rebuilt without
        // this entry would delete the comparison silently, which is the one
        // failure this pin exists to prevent.
        if (!fixture.removal) {
            throw new Error(
                `[T037] ${FIXTURES_BASENAME} has no "removal" entry — the comparison did not run. `
                + 'Re-capture it (see T037) rather than removing this test.',
            );
        }
        await removeInboxWord(cfg, { term: 'Ephemeral' });
        expect(normalizeBody(commits[0], 'uid-1', wordKey('Ephemeral')))
            .toEqual(stripMeta(fixture.removal));
    });
});

// --- Cycle E: the create-refusal retry ------------------------------------
//
// The seam. A device that has never synced cannot know whether a word already
// has a document, so it sends the create form and lets the server say. The
// rules refuse it — `currentDocument: { exists: false }` against a document
// that exists — and the client retries as a re-activation.
//
// What is under test here is a PLACEMENT, not a behaviour in the abstract. The
// refusal arrives as `Firestore commit 403`, which is exactly one of the
// strings `isAuthFailure` matches in background.ts. Retried at that level, the
// first save of an unsynced word would clear the auth state and raise the
// re-authorisation badge — the learner is signed out for saving a word they
// had saved before. So the retry has to live INSIDE addInboxWord, below the
// classifier, and these tests are what pin it there.

describe('a create refused because the document exists', () => {
    /** First :commit refused with 403, second accepted. */
    function refuseThenAccept(): void {
        let commitSeen = 0;
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                commitSeen++;
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                if (commitSeen === 1) {
                    return { ok: false, status: 403, json: async () => ({}), text: async () => 'permission denied' } as any;
                }
                return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }), text: async () => '' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });
    }

    test('the save reports success', async () => {
        refuseThenAccept();
        const r = await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' });
        expect(r.wordId).toBe(wordKey('Ephemeral'));
    });

    test('the retry is the re-activation form, not the create form again', async () => {
        // Sending the create form twice would be refused twice for the same
        // reason. The point of the retry is that it uses the OTHER shape.
        refuseThenAccept();
        await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' });
        expect(commits).toHaveLength(2);
        const second = commits[1].writes.find((w: any) => w.update.name.includes('/words/'));
        expect([...second.updateMask.fieldPaths].sort()).toEqual(['state', 'updatedAt']);
        expect(second.currentDocument).toBeUndefined();
    });

    test('it retries exactly once — a second refusal escapes', async () => {
        let seen = 0;
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                seen++;
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                return { ok: false, status: 403, json: async () => ({}), text: async () => 'denied' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });
        await expect(addInboxWord(cfg, { term: 'x' })).rejects.toThrow(/403/);
        expect(seen).toBe(2);
    });
});

// --- Cycle F: the three refusals, side by side ----------------------------
//
// From contracts/firestore-word-doc.md, "Refusals that are not failures":
// three situations look alike over the wire and two of them mean the opposite
// of the third. A client that applies one response to all three "leaves a word
// unsaved while telling the learner it was saved" — a lie with no complaint
// attached, because nothing visibly fails.
//
// They are asserted in ONE file deliberately: split across files, the pair
// drifts apart the first time someone edits half of it.

describe('the three refusals that look alike', () => {
    /** Every :commit refused with 403; the sentinel read still answers. */
    function refuseCommits(): void {
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                return { ok: false, status: 403, json: async () => ({}), text: async () => 'denied' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });
    }

    test('REMOVAL refused because the document is not active — SUCCESS', async () => {
        // The learner asked for "not saved" and the word is already not saved.
        // Reporting a failure here would ask them to retry an act that has
        // already happened.
        refuseCommits();
        const r = await removeInboxWord(cfg, { term: 'x' });
        expect(r.state).toBe('removed');
    });

    test('REMOVAL against a document that does not exist — SUCCESS', async () => {
        // Nothing to remove; the intent is already true. Indistinguishable
        // from the case above over the wire, and it should be.
        refuseCommits();
        const r = await removeInboxWord(cfg, { term: 'never-saved' });
        expect(r.state).toBe('removed');
    });

    test('CREATE refused because the document exists — NOT a success, a retry', async () => {
        // The opposite response, and the reason these three live together. A
        // create refused this way means the word HAS a document: reporting
        // success would leave it unsaved with the mirror claiming otherwise.
        // T038 owns the retry; what is asserted here is that it is not folded
        // into the benign pair.
        let commitSeen = 0;
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                commitSeen++;
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                if (commitSeen === 1) {
                    return { ok: false, status: 403, json: async () => ({}), text: async () => 'exists' } as any;
                }
                return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }), text: async () => '' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });

        const r = await addInboxWord(cfg, { term: 'x' });
        expect(r.state).toBe('active');
        // Two commits: the create and the re-activation. A "success" response
        // would have sent one.
        expect(commits).toHaveLength(2);
        const second = commits[1].writes.find((w: any) => w.update.name.includes('/words/'));
        expect([...second.updateMask.fieldPaths].sort()).toEqual(['state', 'updatedAt']);
    });

    test('a create refused with 409 ALREADY_EXISTS retries, exactly as a 403 does', async () => {
        // MEASURED ON PREPROD, and it is not what this code was written for.
        //
        // The create form carries `currentDocument: { exists: false }`. That is
        // a Firestore PRECONDITION, not a rule — and a failed precondition is
        // answered `409 ALREADY_EXISTS`, never 403. The rules refuse with 403;
        // the precondition refuses with 409. This client only ever handled the
        // first, so the commonest refusal in the whole feature — saving a word
        // that already has a document — reached the learner as a failed save.
        //
        // That is the exact case wordKey exists to make work: the address is a
        // function of the word, so a second save is the SAME document and must
        // be idempotent. The contract's permission table says "refused — retry
        // with the re-activation form" without naming a code, which is how a
        // 403-only reading survived review.
        let seen = 0;
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                seen++;
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                if (seen === 1) {
                    return {
                        ok: false,
                        status: 409,
                        json: async () => ({}),
                        text: async () => 'ALREADY_EXISTS: entity already exists',
                    } as any;
                }
                return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }), text: async () => '' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });

        const r = await addInboxWord(cfg, { term: 'Ephemeral', context: 'a b c' });

        // Saving an already-saved word SUCCEEDS: same word, same document.
        expect(r.state).toBe('active');
        expect(r.wordId).toBe(wordKey('Ephemeral'));
        // Two commits, and the second is the re-activation form — the same
        // shape the 403 path retries with. Asserted on the mask rather than on
        // the call count alone: re-sending the create form would also be two.
        expect(commits).toHaveLength(2);
        const second = commits[1].writes.find((w: any) => w.update.name.includes('/words/'));
        expect([...second.updateMask.fieldPaths].sort()).toEqual(['state', 'updatedAt']);
        expect(second.currentDocument).toBeUndefined();
    });

    test('a 409 that survives the retry is a failure, not a silent success', async () => {
        // The boundary: one retry, and the second refusal escapes. A client
        // that swallowed a repeated 409 would report a save that never landed.
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                return { ok: false, status: 409, json: async () => ({}), text: async () => 'ALREADY_EXISTS' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });

        await expect(addInboxWord(cfg, { term: 'x' })).rejects.toThrow(/409/);
        expect(commits).toHaveLength(2);
    });

    test('a create refused twice reports the RULES, not a broken session', async () => {
        // The seam, asserted on the live function rather than on a mock.
        //
        // The retry above resolves the one benign create refusal. Anything
        // still 403 after it was refused for what the write ASKED — the rate
        // limit, the daily cap, a shape the rules decline — and never for who
        // asked: a rejected token answers 401, and the refresh path already
        // handled that before this point.
        //
        // The message must therefore NOT read `Firestore commit 403`, because
        // that is one of the strings `isAuthFailure` matches in background.ts.
        // With it, two saves inside MIN_INTERVAL_MS sign the learner out.
        //
        // Asserted as "does not carry the classifier's string" as well as
        // "carries its own": pinning only the new spelling would pass on a
        // message that carried both.
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes(':commit')) {
                commits.push(JSON.parse(String(init?.body ?? '{}')));
                return { ok: false, status: 403, json: async () => ({}), text: async () => 'denied' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });

        await expect(addInboxWord(cfg, { term: 'x' })).rejects.toThrow(/Firestore rules 403/);
        expect(commits).toHaveLength(2);

        const message = await addInboxWord(cfg, { term: 'y' }).catch((e: Error) => e.message);
        expect(message).not.toContain('Firestore commit 403');
    });

    test('a removal that fails for any other reason is still a failure', async () => {
        // The benign pair must not swallow real errors: a 500 is not "already
        // done", and treating it as success would set the mirror to `removed`
        // for a word still active in the store.
        (global as any).fetch = jest.fn(async (url: string) => {
            if (String(url).includes(':commit')) {
                return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } as any;
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
        });
        await expect(removeInboxWord(cfg, { term: 'x' })).rejects.toThrow(/500/);
    });
});
