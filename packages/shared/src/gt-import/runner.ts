// Google Translate import, the worker side.
//
// Two steps, both started from the popup:
//   GT_IMPORT_START   read the list, compare with the server, store a preview;
//   GT_IMPORT_CONFIRM write the new words one ordinary save at a time.
// The state lives in chrome.storage.session so the popup can be closed and
// reopened mid-import and still show where it is; it is gone with the browser
// session, and nothing in it outlives the import that made it.
//
// Writes go through addInboxWord like every other save: one commit per word,
// the rules' sentinel advanced by one. No server path, no batch.

import { track } from '../analytics-bg';
import { config } from '../auth/config';
import { devEnvReady, stampLocalWrite } from '../auth/background';
import { addInboxWord, listInboxWords } from '../auth/firestoreRest';
import { getAuthState, GT_IMPORT_KEYS } from '../auth/storage';
import { loadLanguagePrefs } from '../languages';
import { normalizeTerm } from '../word-key';
import { applySyncedDocs, setMirrorEntry } from '../word-mirror';
import { planImport, type KnownState } from './plan';
import { readGoogleSaved, type ReadResult } from './read-saved';

export const SAVED_URL = 'https://translate.google.com/saved';

// The rules' minimum gap between two saves. The import starts with no pause
// (the planned rules value is 100 ms, shorter than one save takes) and falls
// back to this gap after the first refusal, so it also works against rules that
// still demand a second.
const FALLBACK_GAP_MS = 1100;

const LOAD_TIMEOUT_MS = 30_000;

export type ImportPhase = 'reading' | 'preview' | 'writing' | 'done' | 'error';

export type ImportError =
    | 'not_signed_in'
    | 'no_list' // the page had no saved list: Google signed out, empty, or the page changed
    | 'tab_failed'
    | 'server' // listing the learner's words failed
    | 'daily_limit'
    | 'write_failed';

export interface ImportState {
    phase: ImportPhase;
    toAdd: string[];
    already: number;
    removed: number;
    skipped: number;
    /** Words in the list to write. */
    total: number;
    done: number;
    added: number;
    /** Created by another device between the preview and the write. */
    existed: number;
    /** Refused by the rules twice, even after the one-second gap. */
    refused: number;
    error?: ImportError;
    /** Phrases on the page, read before a signed-out learner is asked to sign in. */
    found?: number;
}

const KEY = GT_IMPORT_KEYS.state;

function blank(phase: ImportPhase): ImportState {
    return { phase, toAdd: [], already: 0, removed: 0, skipped: 0, total: 0, done: 0, added: 0, existed: 0, refused: 0 };
}

export async function loadImportState(): Promise<ImportState | null> {
    const v = (await chrome.storage.session.get(KEY)) as Record<string, ImportState | undefined>;
    return v[KEY] ?? null;
}

async function save(state: ImportState): Promise<void> {
    await chrome.storage.session.set({ [KEY]: state });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait for a tab to finish loading, at most LOAD_TIMEOUT_MS. */
function waitForLoad(tabId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error('tab load timeout'));
        }, LOAD_TIMEOUT_MS);
        function onUpdated(id: number, info: { status?: string }) {
            if (id !== tabId || info.status !== 'complete') return;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

async function readList(): Promise<ReadResult> {
    const tab = await chrome.tabs.create({ url: SAVED_URL, active: false });
    const tabId = tab.id;
    if (tabId === undefined) throw new Error('no tab id');
    // The wait is inside the try: a page that never finishes loading still has
    // its hidden tab closed, rather than one more left behind per attempt.
    try {
        await waitForLoad(tabId);
        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readGoogleSaved });
        return (res?.result as ReadResult | undefined) ?? { via: 'none', pairs: [] };
    } finally {
        chrome.tabs.remove(tabId).catch(() => undefined);
    }
}

let running = false;

export async function startImport(): Promise<ImportState> {
    if (running) return (await loadImportState()) ?? blank('reading');
    running = true;
    try {
        return await prepare();
    } finally {
        running = false;
    }
}

async function prepare(): Promise<ImportState> {
    await devEnvReady();
    // Read before the sign-in check: the list is on Google's page and needs no
    // Lingogram account, and a signed-out learner is asked to sign in with
    // the number of their own phrases in front of them.
    const signedIn = !!(await getAuthState());
    await save(blank('reading'));

    let read: ReadResult;
    try {
        read = await readList();
    } catch {
        const s = { ...blank('error'), error: 'tab_failed' as const };
        await save(s);
        return s;
    }
    if (read.via === 'none' || read.pairs.length === 0) {
        const s = { ...blank('error'), error: 'no_list' as const };
        await save(s);
        void track('gt_import_preview', { found: 0 });
        return s;
    }
    if (!signedIn) {
        const s: ImportState = { ...blank('error'), error: 'not_signed_in', found: read.pairs.length };
        await save(s);
        return s;
    }

    // The server's list, not the mirror: the mirror can lag another device, and
    // a removed word it has not heard of would be written back.
    const known = new Map<string, KnownState>();
    try {
        const docs = await listInboxWords(config, 0);
        for (const d of docs) known.set(normalizeTerm(d.term), d.state);
        if (docs.length > 0) {
            await applySyncedDocs(docs.map((d) => ({ term: d.term, state: d.state, updatedAt: d.updatedAt })));
        }
    } catch {
        const s = { ...blank('error'), error: 'server' as const };
        await save(s);
        return s;
    }

    const learning = (await loadLanguagePrefs())?.learning ?? 'en';
    const plan = planImport(read.pairs, learning, known, __LIMIT_MAX_TERM_BYTES__);
    const s: ImportState = {
        ...blank('preview'),
        toAdd: plan.toAdd,
        already: plan.already,
        removed: plan.removed,
        skipped: plan.skipped,
        total: plan.toAdd.length,
    };
    await save(s);
    void track('gt_import_preview', {
        found: read.pairs.length,
        to_add: plan.toAdd.length,
        already: plan.already,
        removed: plan.removed,
        skipped: plan.skipped,
    });
    return s;
}

type WriteOutcome = 'added' | 'existed' | 'refused' | 'daily_limit' | 'failed';

async function writeOne(term: string): Promise<WriteOutcome> {
    stampLocalWrite(term);
    try {
        await addInboxWord(config, { term, context: '' }, { createOnly: true });
        return 'added';
    } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        if (m.startsWith('Firestore exists')) return 'existed';
        if (m.startsWith('Daily limit')) return 'daily_limit';
        if (m.startsWith('Firestore rules 403')) return 'refused';
        return 'failed';
    }
}

export async function confirmImport(): Promise<ImportState | null> {
    const state = await loadImportState();
    // 'writing' with nothing running = the worker was stopped mid-import; the
    // popup asks again on open and the write resumes from `done`.
    if (!state || (state.phase !== 'preview' && state.phase !== 'writing') || running) return state;
    running = true;
    try {
        return await write(state);
    } finally {
        running = false;
    }
}

async function write(start: ImportState): Promise<ImportState> {
    await devEnvReady();
    const s: ImportState = { ...start, phase: 'writing' };
    await save(s);
    let gap = 0;
    for (const term of start.toAdd.slice(start.done)) {
        if (gap) await sleep(gap);
        let outcome = await writeOne(term);
        // A refusal of a fresh create is most likely the rules' interval:
        // retried once after the old one-second gap, which then paces the rest.
        // A second refusal is something else (a word created since the preview,
        // which the rules refuse before the precondition, or a shape they
        // decline) and is counted, not hidden.
        if (outcome === 'refused') {
            gap = FALLBACK_GAP_MS;
            await sleep(gap);
            outcome = await writeOne(term);
        }
        if (outcome === 'daily_limit' || outcome === 'failed') {
            s.phase = 'error';
            s.error = outcome === 'daily_limit' ? 'daily_limit' : 'write_failed';
            break;
        }
        if (outcome === 'added') {
            s.added++;
            // Marked as it lands: a worker stopped mid-import must not lose
            // the words already written from the mirror, or from the count
            // the popup reads off it.
            await setMirrorEntry(term, 'active');
        } else if (outcome === 'existed') {
            s.existed++;
        } else {
            s.refused++;
        }
        s.done++;
        await save(s);
    }
    if (s.phase === 'writing') s.phase = 'done';
    await save(s);
    void track('gt_import_done', {
        added: s.added,
        existed: s.existed,
        refused: s.refused,
        left: s.total - s.done,
        error: s.error ?? '',
    });
    return s;
}

export async function resetImport(): Promise<void> {
    if (running) return;
    await chrome.storage.session.remove(KEY);
}

/**
 * A worker that starts with an import half written carries on with it. Chrome
 * stops an idle worker and starts it again on the next event; without this the
 * rest of the list waited for the popup to be opened again, and was lost with
 * the browser session if it never was.
 */
export async function resumeInterrupted(): Promise<void> {
    const state = await loadImportState();
    if (state?.phase === 'writing') await confirmImport();
}

export const GT_IMPORT_ACTIONS = ['GT_IMPORT_START', 'GT_IMPORT_CONFIRM', 'GT_IMPORT_RESET', 'GT_IMPORT_STATE'] as const;

const GT_ORIGIN = 'https://translate.google.com';

/**
 * The popup (no tab), this extension's own page in a tab (the settings page),
 * or its script in a Google Translate tab.
 */
export function importSenderAllowed(sender: chrome.runtime.MessageSender): boolean {
    if (sender.id !== chrome.runtime.id) return false;
    if (!sender.tab) return true;
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '');
    // An extension page opened as a tab carries a tab too. Its origin is the
    // extension's own, which a page on the web cannot have.
    if (origin === `chrome-extension://${chrome.runtime.id}` && sender.frameId === 0) return true;
    return origin === GT_ORIGIN && sender.frameId === 0;
}

/** Wire the popup's three messages. Called from each edition's worker. */
export function installGtImport(): void {
    // Runs as the worker starts: a failure here must not become an unhandled
    // rejection in the worker; the learner can start the import again.
    resumeInterrupted().catch((err) => console.warn('[Lingogram] GT import resume failed:', err));
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        // The extension's own pages, and its button on translate.google.com.
        // Not a content script anywhere else: those run in pages the learner
        // did not open for this.
        if (!importSenderAllowed(sender)) return false;
        const action = (msg as { action?: unknown })?.action;
        let job: Promise<unknown>;
        if (action === 'GT_IMPORT_START') job = startImport();
        else if (action === 'GT_IMPORT_CONFIRM') {
            // Answered at once, written after: Chrome stops a worker that holds
            // one message open for about five minutes, which a long list
            // outlasts. The popup follows the progress through storage.
            void confirmImport();
            job = loadImportState();
        } else if (action === 'GT_IMPORT_RESET') job = resetImport();
        // The button on Google Translate cannot read session storage (content
        // scripts are kept out of it); it asks for the state instead.
        else if (action === 'GT_IMPORT_STATE') job = loadImportState();
        else return false;
        job.then(
            (r) => sendResponse({ ok: true, state: r ?? null }),
            (e) => sendResponse({ ok: false, error: String(e) }),
        );
        return true;
    });
}
