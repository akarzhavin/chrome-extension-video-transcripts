/**
 * @jest-environment jsdom
 *
 * The heart reads the mirror.
 *
 * Until now a word was filled only if it had been saved in this tab, in this
 * session: the marker lived in memory and died with the page. A learner who
 * saved a word, reloaded, and hovered it again was told it was not saved — the
 * heart lied, and the record in Firestore said otherwise.
 *
 * These tests seed `chrome.storage.local` directly and assert what the surfaces
 * paint on FIRST sight of a word, having saved nothing in this session. That is
 * the whole claim: the marker survives the page.
 *
 * Everything asserted here comes from the mirror contents the test writes, not
 * from prose about them.
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
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const k of arr) {
                    changes[k] = { oldValue: store[k], newValue: undefined };
                    delete store[k];
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
        },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        onChanged: {
            addListener: jest.fn((l: any) => {
                listeners.push(l);
            }),
            removeListener: jest.fn((l: any) => {
                const i = listeners.indexOf(l);
                if (i >= 0) listeners.splice(i, 1);
            }),
        },
    },
    // analytics reads getManifest as its module initialises, so it must exist
    // before the imports below — same reason word-screen.test.ts states.
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' },
};

import { MIRROR_KEY, setMirrorEntry } from '../src/word-mirror';
import { WordScreen, type WordScreenHost } from '../src/lookup/word-screen';
import { LookupResult } from '../src/lookup';

const answer: LookupResult = {
    term: 'going',
    lemma: 'go',
    translations: ['идти', 'ходить'],
    parts_of_speech: [{
        tag: 'v.', label: 'Verb',
        senses: [{ translations: [], definition: 'To move from one place to another.', examples: [] }],
    }],
    source: 'wiktionary',
};

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
};

/** A surface: its own DOM, its own WordScreen — as a second tab would be. */
function surface(): { screen: WordScreen; panel: HTMLDivElement } {
    const sidebar = document.createElement('div');
    const panel = document.createElement('div');
    const title = document.createElement('h2');
    const backBtn = document.createElement('button');
    document.body.append(sidebar, panel, title, backBtn);
    const host: WordScreenHost = {
        sidebar: () => sidebar,
        panel: () => panel,
        title: () => title,
        backBtn: () => backBtn,
        langPrefs: () => ({ learning: 'en', native: 'ru' }),
        isCollapsed: () => sidebar.classList.contains('collapsed'),
        openPanel: jest.fn(),
        collapse: jest.fn(),
        toggleCollapsed: jest.fn(),
        closeOtherTakeovers: jest.fn(),
        restoreTranscriptScroll: jest.fn(),
    } as unknown as WordScreenHost;
    return { screen: new WordScreen(host), panel };
}

const heartFilled = (panel: HTMLElement): boolean =>
    panel.querySelector('.vtt-lookup-head-heart')!.classList.contains('saved');

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    listeners.length = 0;
    document.body.innerHTML = '';
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
        (msgObj: any, cb?: (r: unknown) => void) => {
            const res = msgObj?.action === 'LOOKUP_WORD'
                ? { ok: true, result: answer }
                : { ok: true, wordId: 'w1' };
            cb?.(res);
            return Promise.resolve(res);
        });
});

describe('a word saved before this page existed', () => {
    test('renders filled on first paint, with nothing saved in this session', async () => {
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(s.panel)).toBe(true);
    });

    test('a word the mirror does not know renders empty', async () => {
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('sailing', 'we are sailing home');
        await flush();
        expect(heartFilled(s.panel)).toBe(false);
    });

    test('a word the mirror calls removed renders empty, not filled', async () => {
        // 'removed' is kept in the mirror precisely so it can be told apart
        // from a word that was never saved. For the heart, though, it reads the
        // same as absence — the learner took it off their list.
        await setMirrorEntry('going', 'removed');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(s.panel)).toBe(false);
    });
});

describe('opening a word costs no network request', () => {
    // Signed by what it protects, not by what it measures: a hover that reaches
    // the network makes the heart lie again whenever the connection is poor —
    // exactly the defect this feature exists to remove. A slow or failed
    // request would paint an empty heart on a word the learner has saved, which
    // is the pre-mirror behaviour under a different cause.
    test('deciding whether a word is saved sends no message', async () => {
        await setMirrorEntry('going', 'active');
        const s = surface();
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        s.screen.open('going', 'we are going home');
        await flush();
        const saveRelated = (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .filter(([m]) => m?.action === 'ADD_WORD' || m?.action === 'SYNC_WORDS');
        expect(saveRelated).toHaveLength(0);
        expect(heartFilled(s.panel)).toBe(true);
    });
});

describe('scenario 5 — a second tab, already open, follows along', () => {
    // Distinct from two surfaces in one tab reading one mirror (scenario 2):
    // this is a chrome.storage.onChanged delivery reaching a content script
    // that already exists. The second surface must NOT be re-created.
    test('a surface that never re-opened shows a word saved elsewhere', async () => {
        const first = surface();
        const second = surface();

        second.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(second.panel)).toBe(false);

        // The other tab saves the word: the worker writes the mirror.
        void first;
        await setMirrorEntry('going', 'active');
        await flush();

        // Same instance, never rebuilt, re-opening the same word.
        second.screen.close();
        second.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(second.panel)).toBe(true);
    });

    test('a mirror wiped elsewhere empties the heart too', async () => {
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(s.panel)).toBe(true);

        await (global as any).chrome.storage.local.remove(MIRROR_KEY);
        await flush();

        s.screen.close();
        s.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(s.panel)).toBe(false);
    });
});

// T010's red, written here and before it. The mirror is written BEFORE the
// message goes out, so the heart is filled the instant it is pressed; a refusal
// must put back exactly what was there, including "absent" — a failed first
// save that left a 'removed' entry behind would suppress the retry.
describe('a save writes the mirror first and rolls back on failure', () => {
    test('a failed save restores the exact previous value — absent stays absent', async () => {
        const { saveTerm } = await import('../src/content/quick-add-overlay');
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m: any, cb?: (r: unknown) => void) => {
                const res = { ok: false, error: 'add failed' };
                cb?.(res);
                return Promise.resolve(res);
            });

        const before = (store[MIRROR_KEY] as any)?.words?.going;
        expect(before).toBeUndefined();

        await saveTerm('going', 'we are going home', []);
        await flush();

        const after = (store[MIRROR_KEY] as any)?.words?.going;
        // Absent, not 'removed': a 'removed' entry would be read as a
        // deliberate un-save and would suppress the retry.
        expect(after).toBeUndefined();
    });

    test('a failed save over an existing entry restores that entry, not a default', async () => {
        const { saveTerm } = await import('../src/content/quick-add-overlay');
        await setMirrorEntry('going', 'removed');
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m: any, cb?: (r: unknown) => void) => {
                const res = { ok: false, error: 'add failed' };
                cb?.(res);
                return Promise.resolve(res);
            });

        await saveTerm('going', 'we are going home', []);
        await flush();

        expect((store[MIRROR_KEY] as any)?.words?.going).toBe('removed');
    });

    // GREEN AT T010, BUT ONLY HALF THE CLAIM — read this before trusting it.
    //
    // What passes here is that saveTerm SENDS one `SYNC_WORDS` after a timeout
    // and none after a refusal. That is the distinction T010 owns, and it is
    // decided in T010's code, so it is asserted here.
    //
    // What is NOT covered is that anything receives it: no worker route handles
    // `SYNC_WORDS` yet — `grep -rn SYNC_WORDS packages apps --include='*.ts'`
    // finds only the sender, measured 2026-09-07. This test is green because
    // the stub answers every message; in the browser the send resolves into
    // nothing. **T027** adds the route, and the end-to-end claim belongs to it.
    // Until then a timeout leaves the mirror correctly rolled back and the
    // reconciliation simply does not happen — the pre-mirror state, not a
    // regression.
    test('a timed-out save schedules exactly one sync pass; a refused save schedules none', async () => {
        const { saveTerm } = await import('../src/content/quick-add-overlay');
        const syncCalls = () =>
            (chrome.runtime.sendMessage as jest.Mock).mock.calls
                .filter(([m]) => m?.action === 'SYNC_WORDS');

        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m: any, cb?: (r: unknown) => void) => {
                const res = { ok: false, error: 'timeout' };
                cb?.(res);
                return Promise.resolve(res);
            });
        await saveTerm('going', 'we are going home', []);
        await flush();
        expect(syncCalls()).toHaveLength(1);

        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (_m: any, cb?: (r: unknown) => void) => {
                const res = { ok: false, error: 'add failed' };
                cb?.(res);
                return Promise.resolve(res);
            });
        await saveTerm('sailing', 'we are sailing home', []);
        await flush();
        expect(syncCalls()).toHaveLength(0);
    });
});

// --- Cycle F: the toggle -------------------------------------------------
//
// US2, the named behaviour change: a second click on a filled heart un-saves
// the word. Today both surfaces guard against it — `strip.ts` and
// `word-screen.ts` each return early when the word is already saved, with a
// comment saying that saving again is not un-saving. That was true while
// removal lived only in the site's word list; it stops being true here.
//
// The assertions below come from spec.md's six US2 scenarios and from
// contracts/messages.md's REMOVE_WORD shape — not from the code they test.

describe('the toggle: a second click removes', () => {
    const sent = (action: string): any[] =>
        (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0])
            .filter((m) => m?.action === action);

    test('a saved word offers Remove, not Saved', async () => {
        // Scenario 1. The label is what tells the learner the click is
        // available at all; "Saved" reads as a statement, "Remove" as an offer.
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        const heart = s.panel.querySelector('.vtt-lookup-head-heart')!;
        expect(heart.getAttribute('aria-label')).toBe('Remove');
    });

    test('clicking a filled heart empties it and sends REMOVE_WORD', async () => {
        // Scenario 2, and the message shape is messages.md's, not invented
        // here: { action: 'REMOVE_WORD', term, site }.
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        s.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();

        expect(sent('REMOVE_WORD')).toHaveLength(1);
        expect(sent('REMOVE_WORD')[0].term).toBe('going');
        expect(heartFilled(s.panel)).toBe(false);
    });

    test('the mirror says removed straight away, before any response', async () => {
        // Scenario 2's "immediately": the mirror is written before the message
        // goes out, exactly as a save is (FR-013).
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        s.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();
        expect((store[MIRROR_KEY] as any).words.going).toBe('removed');
    });

    test('a failed removal puts the heart back and restores the mirror', async () => {
        // Scenario 5. Rollback is symmetric with a failed save's.
        //
        // ⚠ GREEN ON ARRIVAL, and for the wrong reason: today the click is a
        // no-op, so the heart stays filled and the mirror stays `active`
        // without any rollback happening. It only becomes meaningful once
        // T021/T022 land — recorded here so the cycle's red count is not read
        // as coverage.
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();

        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            (m: any, cb?: (r: unknown) => void) => {
                const res = m?.action === 'LOOKUP_WORD'
                    ? { ok: true, result: answer }
                    : { ok: false, error: 'remove failed' };
                cb?.(res);
                return Promise.resolve(res);
            });

        s.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();

        expect(heartFilled(s.panel)).toBe(true);
        expect((store[MIRROR_KEY] as any).words.going).toBe('active');
    });

    test('re-saving a removed word sends ADD_WORD again, not REMOVE_WORD', async () => {
        // Scenario 3 and 4: a removed word reads as unsaved, and saving it
        // again is an ordinary save that costs a unit of the daily cap.
        //
        // ⚠ Also green on arrival: a word the mirror calls `removed` already
        // renders empty (cycle C), so the click is an ordinary save today too.
        // What it will guard after T021/T022 is that the toggle reads the
        // mirror's state rather than "has this word ever been saved".
        await setMirrorEntry('going', 'removed');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        expect(heartFilled(s.panel)).toBe(false);

        s.panel.querySelector<HTMLButtonElement>('.vtt-lookup-head-heart')!.click();
        await flush();

        expect(sent('ADD_WORD')).toHaveLength(1);
        expect(sent('REMOVE_WORD')).toHaveLength(0);
    });

    test('both controls agree — pressing either toggles both', async () => {
        await setMirrorEntry('going', 'active');
        const s = surface();
        s.screen.open('going', 'we are going home');
        await flush();
        s.panel.querySelector<HTMLButtonElement>('.vtt-lookup-save')!.click();
        await flush();

        expect(s.panel.querySelector('.vtt-lookup-head-heart')!.classList.contains('saved')).toBe(false);
        expect(s.panel.querySelector('.vtt-lookup-save')!.classList.contains('saved')).toBe(false);
    });
});
