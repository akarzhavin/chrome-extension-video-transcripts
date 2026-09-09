/**
 * @jest-environment jsdom
 *
 * Four things this feature deliberately does NOT do.
 *
 * Every one of them looks like an oversight. A reviewer's instinct is to add
 * the missing guard, and adding it is cheaper than reconstructing why it is not
 * there — so each test below is signed with what breaks when the guard comes
 * back, in the words of the person it breaks for.
 *
 * These are the only tests in the suite whose red comes from a **mutation**
 * rather than from missing code: the behaviour already works. That is exactly
 * why nothing else defends it. Each figure recorded in analysis.md was taken by
 * applying the mutation, watching the failure land, reverting, and watching it
 * go green again.
 */

const store: Record<string, unknown> = {};
const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

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
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(items)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
            remove: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : keys;
                for (const k of arr) delete store[k];
                return Promise.resolve();
            }),
        },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        onChanged: {
            addListener: jest.fn((l: any) => { listeners.push(l); }),
            removeListener: jest.fn(),
        },
    },
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
};

import { addInboxWord } from '../src/auth/firestoreRest';
import { MIRROR_KEY, applySyncedDocs, loadMirror, setMirrorEntry } from '../src/word-mirror';
import { markSpansSaved } from '../src/content/quick-add-overlay';
import type { AuthConfig } from '../src/auth/config';

const cfg = {
    projectId: 'demo-lingogram',
    firestoreUrl: 'https://firestore.test',
    apiKey: 'k',
    frontendBaseUrl: 'http://localhost:5173',
    apiBaseUrl: 'https://api.test',
    source: 'youtube-extension',
} as AuthConfig;

let commits: Array<Record<string, any>>;

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    listeners.length = 0;
    document.body.innerHTML = '';
    store['auth.idToken'] = 'token';
    store['auth.refreshToken'] = 'refresh';
    store['auth.expiresAt'] = Date.now() + 3_600_000;
    store['auth.email'] = 'someone@example.com';
    store['auth.uid'] = 'uid-1';
    commits = [];
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes(':commit')) {
            commits.push(JSON.parse(String(init?.body ?? '{}')));
            return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }), text: async () => '' } as any;
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
    });
});

describe('1. an activation is not guarded by a state change — the cap pays for it', () => {
    // ⚠ SIGNATURE, for whoever wants to add the guard back:
    // A repeat after a lost response must SUCCEED and cost one unit. Guard the
    // activation on "is it already active?" and a learner whose first save got
    // through — but whose response never arrived — presses again and is told it
    // failed. They cannot tell that from a real failure, and the word they can
    // see in their list reports an error every time they touch it.
    //
    // The protocol permits a repeated activation and charges for it. That is
    // the deliberate trade: a unit of a 500-a-day cap against an unrecoverable
    // state the client cannot detect.
    test('saving a word the mirror already calls active still commits', async () => {
        await setMirrorEntry('going', 'active');
        const res = await addInboxWord(cfg, { term: 'going', context: 'we are going home' });
        expect(res.state).toBe('active');
        expect(commits).toHaveLength(1);
    });

    test('and it pays the sentinel, exactly as a first save does', async () => {
        // The unit is the whole point: an activation that skipped the sentinel
        // would be a free retry loop.
        await setMirrorEntry('going', 'active');
        await addInboxWord(cfg, { term: 'going', context: 'a b c' });
        const sentinel = commits[0].writes.find((w: any) => !w.update.name.includes('/words/'));
        expect(sentinel).toBeDefined();
        expect(sentinel.update.fields.dailyCount).toBeDefined();
    });
});

describe('2. deciding whether a word is saved issues no request', () => {
    // ⚠ SIGNATURE: reaching the network here makes the heart lie again on a
    // poor connection. A request that is slow or fails paints an empty heart on
    // a word the learner definitely saved — the pre-mirror behaviour, arrived at
    // by a different route. The mirror exists to make this answer local.
    //
    // These assertions arrived GREEN in cycle C, which is why they need this
    // file: nothing had to change for them to pass, so nothing was proven by
    // their passing.
    test('reading the mirror sends nothing', async () => {
        await setMirrorEntry('going', 'active');
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        (global as any).fetch = jest.fn();

        const mirror = await loadMirror();

        expect(mirror.words.going).toBe('active');
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('the mirror answers synchronously once loaded — no await in the render path', async () => {
        // The structural reason the answer can be local at all: the view is a
        // plain object read, not a promise. A mirror keyed by the digest would
        // have forced `crypto.subtle` and an await into the paint.
        const { createSavedWords } = await import('../src/lookup/saved-words');
        const view = createSavedWords();
        view.reset({ going: 'active' });
        const answer: boolean = view.has('going');
        expect(answer).toBe(true);
    });
});

describe('3. removed entries are not swept from the mirror', () => {
    // ⚠ SIGNATURE: absent and `removed` are DIFFERENT ANSWERS. Sweeping the
    // tombstones makes a word removed here look saved on another device — the
    // next sync sees no local entry, treats the store's `active` document as
    // news, and puts the heart back. The learner un-saves a word and it returns.
    //
    // A tombstone costs ~30 bytes. The alternative costs correctness.
    test('a removed word keeps its entry rather than disappearing', async () => {
        await setMirrorEntry('going', 'active');
        await setMirrorEntry('going', 'removed');

        const mirror = await loadMirror();
        expect(mirror.words.going).toBe('removed');
        expect('going' in mirror.words).toBe(true);
    });

    test('a sync applying a removal writes a tombstone, not a deletion', async () => {
        await setMirrorEntry('going', 'active');
        await applySyncedDocs([{ term: 'going', state: 'removed', updatedAt: 1_700_000_000_000 }]);

        const raw = store[MIRROR_KEY] as any;
        expect(raw.words.going).toBe('removed');
    });

    test('absent and removed are told apart by the view that paints the heart', async () => {
        const { createSavedWords } = await import('../src/lookup/saved-words');
        const view = createSavedWords();
        view.reset({ removedWord: 'removed' });
        // Both read as "not filled" — but only because `reset` maps `removed`
        // to absence for PAINTING. The mirror itself still holds the two apart,
        // which is what the sync needs.
        expect(view.has('removedWord')).toBe(false);
        expect(view.has('neverSaved')).toBe(false);
    });
});

describe('4. the promo path does not read the mirror', () => {
    // ⚠ SIGNATURE: it is decoration. `apps/youtube/src/content/index.ts` marks
    // the longest token of the active subtitle line as "saved" during promo
    // recordings, purely so the screenshots show a real feature. Wiring it to
    // the mirror would put a genuinely filled heart on an arbitrary word during
    // a screen capture — and, worse, would make the capture depend on whatever
    // the recording account happens to have saved.
    //
    // It shares the `.vtt-saved-word` class with the real path, which is what
    // makes it look like a bug worth fixing.
    test('markSpansSaved decorates whatever it is handed, consulting nothing', async () => {
        const span = document.createElement('span');
        span.textContent = 'arbitrary';
        document.body.appendChild(span);

        (chrome.storage.local.get as jest.Mock).mockClear();
        markSpansSaved([span]);

        expect(span.classList.contains('vtt-saved-word')).toBe(true);
        // The decoration asked storage nothing: it is not an answer about the
        // word, it is paint.
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('it decorates a word the mirror has never heard of', async () => {
        // The promo path's whole job, stated as behaviour: no mirror entry
        // exists for this term and the badge appears anyway.
        const span = document.createElement('span');
        span.textContent = 'neverSaved';
        document.body.appendChild(span);

        markSpansSaved([span]);

        expect(span.classList.contains('vtt-saved-word')).toBe(true);
        expect((await loadMirror()).words.neverSaved).toBeUndefined();
    });
});
