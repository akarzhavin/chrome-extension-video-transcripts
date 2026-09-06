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

import { addInboxWord } from '../src/auth/firestoreRest';
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
    test('exactly four fields, and no more', async () => {
        await addInboxWord(cfg, { term: 'ephemeral', context: 'a b c' });
        expect(Object.keys(wordFields()).sort()).toEqual(['context', 'processed', 'source', 'term']);
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

    test('the term is stored as given', async () => {
        await addInboxWord(cfg, { term: 'Ephemeral' });
        expect(wordFields().term).toEqual({ stringValue: 'Ephemeral' });
    });

    test('the edition is recorded', async () => {
        await addInboxWord(cfg, { term: 'x' });
        expect(wordFields().source).toEqual({ stringValue: 'youtube-extension' });
    });

    test('the time comes from the server, never the device', async () => {
        // A device clock drifts; the rule the write must satisfy compares
        // against the server's own request time.
        await addInboxWord(cfg, { term: 'x' });
        expect(wordWrite().updateTransforms).toEqual([
            { fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' },
        ]);
        expect(JSON.stringify(wordFields())).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    test('a word saved with no context sends no empty context', async () => {
        await addInboxWord(cfg, { term: 'x' });
        expect(wordFields()).not.toHaveProperty('context');
    });

    test('saving the same word twice creates a second entry', async () => {
        // No de-duplication by design: the same word met twice is two
        // encounters. Two distinct ids, two writes, and no lookup in between.
        const a = await addInboxWord(cfg, { term: 'same' });
        const b = await addInboxWord(cfg, { term: 'same' });
        expect(a.wordId).not.toEqual(b.wordId);
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
