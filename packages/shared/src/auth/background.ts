// Relative import (not the package barrel) because analytics-bg carries the
// GA4 api_secret and must never be pulled into a content-script bundle.
import { handleTrackMessage, track } from '../analytics-bg';
import { config } from './config';
// Static, not dynamic: a dynamic import() makes Vite emit sibling .mjs chunks
// that an MV3 service worker cannot load. Static keeps one file, and the
// __EXT_ENV__ literal guards below still drop this module from prod bundles.
import { handleDevAction, restoreEnv, switchableFrontendBaseUrls } from './devEnvSwitch';
// Relative for the same reason as analytics-bg: the worker imports by path,
// and lookup.ts is deliberately absent from the package barrel.
import {
    MAX_LOOKUP_TERM_LEN,
    hasLookupContent,
    isPhrase,
    latencyBucket,
    lookupCached,
    lookupPhraseCached,
} from '../lookup';
import { exchangeCustomToken } from './firebaseRest';
import { addFeedback, addInboxWord, addNoSubsReport, freshIdToken, listInboxWords, removeInboxWord } from './firestoreRest';
import { requestPart, storeTrack, type PartRequest, type StoredTrack } from '../subtitle-ai/worker';
import {
    activateMirrorTerms,
    activeWordCount,
    applySyncedDocs,
    loadMirror,
    setMirrorEntry,
    setMirrorToTerms,
} from '../word-mirror';
import {
    addLocalWord,
    countLocalWords,
    listLocalWords,
    removeLocalWord,
    setLocalTranslation,
} from '../local-words';
import { normalizeTerm } from '../word-key';
import { assertTermFits } from './term-limit';
import { isSiblingMessage } from '../sibling';
import { attachDiag, createWorkerDiag, diagOf } from '../debug/save-diag-worker';
import { loadLanguagePrefs } from '../languages';
// Relative, like analytics-bg above and for the same reason: notifications.ts
// imports analytics-bg to report fetch failures, so it carries the api_secret
// transitively and must stay out of anything a content script can pull in.
import { dismissNotification, getNotification } from '../notifications';
import {
    bumpSavedWordCount,
    clearAuthState,
    clearParkedAuthStates,
    clearPendingAuthNonce,
    getAuthState,
    getNeedsReauth,
    getRatePromptShown,
    markRatePromptShown,
    RATE_PROMPT_WORD_THRESHOLD,
    setAuthState,
    setNeedsReauth,
    setPendingAuthNonce,
    validatePendingAuthNonce,
} from './storage';

export type AuthAction =
    | 'AUTH_STATUS'
    | 'AUTH_SIGN_IN_VIA_LINGOGRAM'
    | 'AUTH_SIGN_OUT'
    | 'OPEN_LINGOGRAM'
    | 'OPEN_EXTENSION_PAGE'
    | 'ADD_WORD'
    | 'REMOVE_WORD'
    | 'LOCAL_WORDS_LIST'
    | 'LOCAL_WORD_SET_TRANSLATION'
    | 'SYNC_WORDS'
    | 'REPORT_NO_SUBS'
    | 'SEND_FEEDBACK'
    | 'TRACK_EVENT'
    | 'GET_NOTIFICATION'
    | 'DISMISS_NOTIFICATION'
    | 'LOOKUP_WORD'
    | 'SUBTITLE_AI_PART'
    | 'SUBTITLE_AI_STORE'
    // Dev-only backend switch. The names are declared for type-checking only;
    // the values live in ./devEnvSwitch so prod bundles never carry them.
    | 'DEV_SET_ENV'
    | 'DEV_GET_ENV';

// Membership here is what isAuthAction() filters on, so an action missing from
// this set is dropped before the handler ever sees it — silently, with no error
// anywhere. (The DEV_* actions are the deliberate exception: they're matched by
// prefix below so their names never appear in a prod bundle.)
export const AUTH_ACTIONS: ReadonlySet<AuthAction> = new Set<AuthAction>([
    'AUTH_STATUS',
    'AUTH_SIGN_IN_VIA_LINGOGRAM',
    'AUTH_SIGN_OUT',
    'OPEN_LINGOGRAM',
    'OPEN_EXTENSION_PAGE',
    'ADD_WORD',
    // Both here AND in the union above. A name in one only passes
    // type-checking and is then dropped by isAuthAction with no error: the
    // message is never handled and the caller's promise never settles.
    'REMOVE_WORD',
    'LOCAL_WORDS_LIST',
    'LOCAL_WORD_SET_TRANSLATION',
    'SYNC_WORDS',
    'REPORT_NO_SUBS',
    'SEND_FEEDBACK',
    'TRACK_EVENT',
    'GET_NOTIFICATION',
    'DISMISS_NOTIFICATION',
    'LOOKUP_WORD',
    'SUBTITLE_AI_PART',
    'SUBTITLE_AI_STORE',
]);

export function isAuthAction(action: unknown): action is AuthAction {
    if (typeof action !== 'string') return false;
    if ((AUTH_ACTIONS as ReadonlySet<string>).has(action)) return true;
    // Dev actions are matched by prefix rather than by name, so no dev action
    // string appears in a prod bundle. Folds away entirely in prod builds.
    return __EXT_ENV__ === 'dev' && action.startsWith('DEV_');
}

// Save diagnostics (debug/save-diag-worker.ts): a collector per ADD_WORD /
// REMOVE_WORD, only when the content script asks (`diag: true`, its
// diagnostics switch is on) and only in a dev build. Module-level so the
// minifier folds every `DIAG_BUILD && …` below out of production.
const DIAG_BUILD = __EXT_ENV__ === 'dev';

export interface AuthMessage {
    action: string;
    [k: string]: unknown;
}

// Surface "the extension needs to be re-authorized" via the toolbar badge.
// Refresh-token failures (revoked session, very long inactivity) now require
// the user to open a normal /extension-auth tab — no silent recovery path.
//
// The fact is also kept in storage (AUTH_STATUS.needsReauth): a popup opened
// later has to be able to say what the "!" means, and the badge alone cannot.
async function setNeedsReauthBadge(): Promise<void> {
    try {
        chrome.action?.setBadgeText({ text: '!' });
        chrome.action?.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } catch {
        // chrome.action unavailable in some test contexts; silent ignore.
    }
    await setNeedsReauth(true);
}

async function clearNeedsReauthBadge(): Promise<void> {
    try {
        chrome.action?.setBadgeText({ text: '' });
    } catch {
        // see setNeedsReauthBadge.
    }
    await setNeedsReauth(false);
}

/**
 * End the session and leave the profile the way a signed-out one looks: the
 * mirror holds exactly the words kept in the browser.
 *
 * `clearAuthState` drops the mirror together with the credentials, which is
 * right for the account's words and wrong for the local ones — they are still
 * saved, and the heart over them and the page highlight read the mirror.
 */
async function endSession(): Promise<void> {
    await clearAuthState();
    await setMirrorToTerms((await listLocalWords()).map((w) => w.term));
}

function isAuthFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const m = err.message;
    return (
        m.includes('Not signed in') ||
        m.includes('Firebase REST 400') ||
        m.includes('Firebase REST 401') ||
        m.includes('Firebase REST 403') ||
        m.includes('Firestore commit 401') ||
        m.includes('Firestore commit 403') ||
        m.includes('Firestore sentinel 401') ||
        m.includes('INVALID_REFRESH_TOKEN') ||
        m.includes('TOKEN_EXPIRED')
    );
}

// Dev builds may be pointed at preprod; restoring that choice is async while
// the message listener is registered synchronously, so a request arriving
// during a cold service-worker start could otherwise be served against prod.
// Awaiting here — a resolved promise after the first call — closes that race.
// Compiled out of prod builds: __EXT_ENV__ is a literal, so the guard folds.
let envRestored: Promise<void> | null = null;

// --- the delta sync ------------------------------------------------------
//
// Ordering against in-flight local writes, from data-model.md. The mirror holds
// no per-word timestamp, so it cannot tell whether a document arriving from a
// sync is newer or older than a change the learner just made. That ordering is
// kept here, in the only process that both writes the mirror and issues syncs.
//
// Deliberately not persisted: it only has to survive between a write and the
// sync racing it, and both live in one worker. If the worker dies the in-flight
// write died with it, and the next sync being authoritative is the correct
// outcome rather than a lost one. It is not a clock, it never reaches the
// cursor, and it is never compared against server time.
let seq = 0;
const localWrites = new Map<string, number>();

// A full sync that came back with nothing to stamp a cursor with, in THIS
// worker.
//
// `cursor: 0` means "never synced" and the contract fixes that meaning, so an
// account with no saved words cannot record progress in the mirror: there is no
// server timestamp to record. Without this flag such an account re-runs the
// unfiltered whole-collection query on every wake, page open and tab focus, for
// as long as it stays empty — the query is cheap on an empty collection but it
// is a round trip per focus event, forever, for an answer that has not changed.
//
// Deliberately worker-lifetime and not persisted: the first save clears it, and
// a worker restart re-checks once, which is the correct amount of paranoia for
// something a second device could have changed while this one was asleep.
//
// Held as the UID it was observed for rather than a boolean, so signing out and
// into another account cannot inherit it. A `null` means "ask". Sign-out needs
// no explicit reset for the same reason: the next account's uid will not match.
let emptyFullSyncUid: string | null = null;

/** Stamp a term as locally changed, before its commit goes out. */
export function stampLocalWrite(term: string): void {
    localWrites.set(normalizeTerm(term), ++seq);
    // This account is no longer empty, whatever the last full sync found.
    emptyFullSyncUid = null;
}

// A sync already running is joined rather than queued: the three triggers fire
// close together in normal use — a worker wake is usually followed immediately
// by a page open — and three passes would cost three reads for one answer.
let inFlight: Promise<SyncResult> | null = null;
let lastFinishedAt = 0;
const SYNC_COOLDOWN_MS = 2_000;
// Documents committed while a query was in flight would otherwise be missed
// forever: re-applying one is idempotent, missing one is permanent.
const OVERLAP_MS = 60_000;

interface SyncResult { ok: boolean; applied?: number; full?: boolean; error?: string }

async function runSync(): Promise<SyncResult> {
    const mirror = await loadMirror();
    const full = mirror.cursor === 0;
    // Only the full-and-empty repeat is skipped, and only for the account it
    // was observed on. A cursor that has advanced takes the filtered query,
    // which is what the sync is for.
    const uid = (await getAuthState())?.uid ?? null;
    if (full && uid !== null && uid === emptyFullSyncUid) {
        return { ok: true, applied: 0, full: true };
    }
    const since = full ? 0 : Math.max(0, mirror.cursor - OVERLAP_MS);
    // Recorded when the query is ISSUED, not when it returns: a write that
    // lands while the query is in flight must win over what the query brings
    // back, and only a value taken now can tell the two apart.
    const issuedAt = seq;
    try {
        const docs = await listInboxWords(config, since);
        // Keyed by `normalizeTerm` on both sides. The stamp comes from a raw
        // term off the page and `d.term` from the document, so a lowercase
        // key would miss the match on exactly the terms the two forms part
        // on — letting a sync overwrite a local write it was meant to yield to.
        const fresh = docs.filter((d) => (localWrites.get(normalizeTerm(d.term)) ?? 0) <= issuedAt);
        // Nothing applied means nothing written: a rewrite with identical
        // contents would wake every subscriber in every open tab.
        if (fresh.length > 0) {
            await applySyncedDocs(fresh.map((d) => ({ term: d.term, state: d.state, updatedAt: d.updatedAt })));
        }
        // Words still waiting in the browser are saved as far as the learner is
        // concerned, whatever the account says about them yet. A sync only
        // writes the entries it was given, so this is for the one it can get
        // wrong: a document the account holds as removed.
        await activateMirrorTerms((await listLocalWords()).map((w) => w.term));
        // A full pass that applied nothing left the cursor at 0, so the next
        // one would be full as well and would ask the same question again.
        // Note the condition is on what the QUERY returned, not on `fresh`: a
        // document held back by `localWrites` is a change this worker itself
        // made, and the sync that follows it must still run.
        if (full && docs.length === 0) emptyFullSyncUid = uid;
        return { ok: true, applied: fresh.length, full };
    } catch (err) {
        // Never rejects: the caller is a background trigger with no one to
        // tell, and the mirror is still usable from what it has.
        return { ok: false, error: String(err instanceof Error ? err.message : err) };
    } finally {
        // Drop the stamps this pass has now outlived.
        //
        // A stamp exists only to outrank the `issuedAt` of a sync racing the
        // write that made it. This query was issued at `issuedAt` and is now
        // over, so every stamp at or below that value has already met the one
        // query that could have raced it, and no later sync can read a smaller
        // `issuedAt` — `seq` only grows. Such an entry can never change an
        // outcome again.
        //
        // In `finally` and not beside the return: a sync that THREW still
        // issued its query, and a failing sync is exactly when the map would
        // otherwise grow without bound.
        //
        // Without this the map keeps one entry per save and removal for the
        // life of the worker — every term the learner touches, held in memory,
        // with nothing outside the test-only reset taking it out.
        for (const [term, at] of localWrites) {
            if (at <= issuedAt) localWrites.delete(term);
        }
    }
}

/**
 * Test seam: how many local-write stamps are being held.
 *
 * The count, not the map — a test has no business reading which terms are in
 * there, and exposing the map would make the pruning's bookkeeping part of the
 * module's surface. What is worth pinning is that the number comes back down.
 */
export function __localWriteCountForTests(): number {
    return localWrites.size;
}

/**
 * Test seam: clear the coalescing state between cases.
 *
 * The cooldown and the in-flight handle are module-scoped because that is what
 * makes three triggers cost one read; a test file running several syncs in a
 * row would otherwise have its second one skipped by the first one's cooldown.
 */
export function __resetSyncStateForTests(): void {
    inFlight = null;
    lastFinishedAt = 0;
    seq = 0;
    localWrites.clear();
    emptyFullSyncUid = null;
}

/**
 * `force` skips the cooldown, for the one trigger that must not be swallowed by
 * it: a sign-in. The worker wake that came just before it ran signed out and
 * found nothing, and a cooldown counted from that pass would leave the new
 * account's mirror empty until some later page woke another sync.
 */
export async function syncWords(opts: { force?: boolean } = {}): Promise<SyncResult> {
    if (inFlight) return inFlight;
    if (!opts.force && Date.now() - lastFinishedAt < SYNC_COOLDOWN_MS) return { ok: true, applied: 0, full: false };
    inFlight = runSync().finally(() => {
        inFlight = null;
        lastFinishedAt = Date.now();
    });
    return inFlight;
}

interface SaveContext {
    site: string;
    signedIn: boolean;
    learning: string;
    native: string;
}

/**
 * What every successful save does after the word is stored, wherever it was
 * stored: the install's running count, the one-shot rating prompt, the funnel's
 * terminal event. A word kept in the browser counts like any other — the learner
 * saved it, and the prompt is about that.
 */
async function afterSave(
    request: AuthMessage,
    ctx: SaveContext,
): Promise<{ inboxCount: number; promptRate: boolean }> {
    const inboxCount = await activeWordCount();
    // Value-moment rating prompt (P1.8): once this install crosses
    // the saved-word threshold, ask for a store rating — exactly
    // once, ever. The content script renders the actual banner when
    // it sees promptRate; here we only decide + burn the one-shot.
    const savedWordCount = await bumpSavedWordCount();
    let promptRate = false;
    // `silent` = the caller has no page UI to render the banner (the
    // context-menu save): burning the one-shot there would spend
    // the only ask on a save nobody saw it on.
    if (
        request.silent !== true &&
        savedWordCount >= RATE_PROMPT_WORD_THRESHOLD &&
        !(await getRatePromptShown())
    ) {
        await markRatePromptShown();
        promptRate = true;
    }
    // The funnel's terminal step. saved_count is this install's
    // running total, which is what makes "how many people reach
    // their 5th / 30th word" answerable. `signed_in: false` now also means
    // "kept in the browser".
    void track('word_saved', {
        site: ctx.site,
        saved_count: savedWordCount,
        signed_in: ctx.signedIn,
        learning: ctx.learning,
        native: ctx.native,
    });
    return { inboxCount, promptRate };
}

// --- moving words kept in the browser into the account ----------------------
//
// The same pacing the Google Translate import uses (gt-import/runner.ts): no
// pause between writes to begin with — the planned rules interval is shorter
// than one write takes — and after the first refusal a one-second gap, which
// then paces the rest, so it also works against rules that still demand a
// second between saves.
const UPLOAD_FALLBACK_GAP_MS = 1100;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface UploadResult {
    ok: boolean;
    /** Words written into the account by this run. */
    uploaded: number;
    /** Words still waiting in the browser afterwards. */
    left: number;
    error?: string;
}

// One upload at a time. A sign-in, a worker start and a save can all ask for it
// within the same second; a second run beside the first would write the same
// words twice and trip the rules' interval against itself.
let uploading: Promise<UploadResult> | null = null;

/**
 * Write the words kept in the browser into the signed-in account, oldest first.
 * A word leaves the local store only after its write succeeded. The first
 * failure ends the run and leaves everything after it local; the next trigger
 * (a sign-in, a worker start, a successful save) tries again. Never rejects.
 */
export function uploadLocalWords(): Promise<UploadResult> {
    if (uploading) return uploading;
    uploading = runUpload().finally(() => {
        uploading = null;
    });
    return uploading;
}

/** Test seam: forget a run that was left hanging by a previous case. */
export function __resetUploadStateForTests(): void {
    uploading = null;
}

/** Still waiting in the browser, by the key the store itself uses. */
async function stillLocal(term: string): Promise<boolean> {
    const key = normalizeTerm(term);
    return (await listLocalWords()).some((w) => normalizeTerm(w.term) === key);
}

async function runUpload(): Promise<UploadResult> {
    let uploaded = 0;
    let left = 0;
    try {
        await devEnvReady();
        const words = (await listLocalWords()).sort((a, b) => a.addedAt - b.addedAt);
        left = words.length;
        let gap = 0;
        for (const w of words) {
            // Checked before every word, not once: a sign-out in the middle of a
            // long run must end it quietly. Writing on would fail as "Not
            // signed in" and be taken for a dead session, raising the badge for
            // a learner who just chose to sign out.
            if (!(await getAuthState())) break;
            if (gap) await sleep(gap);
            // Re-checked after the wait, right before the write: the snapshot
            // above is from the start of the run, and the learner can have
            // removed this word or signed out while it slept.
            if (!(await getAuthState())) break;
            if (!(await stillLocal(w.term))) {
                left--;
                continue;
            }
            stampLocalWrite(w.term);
            try {
                try {
                    await addInboxWord(config, { term: w.term, context: w.context });
                } catch (err) {
                    // A refused write is most likely the rules' interval:
                    // retried once after the old one-second gap, which then
                    // paces the rest. A second refusal is something else and
                    // ends the run.
                    if (!(err instanceof Error) || !err.message.startsWith('Firestore rules 403')) throw err;
                    gap = UPLOAD_FALLBACK_GAP_MS;
                    await sleep(gap);
                    if (!(await getAuthState())) return { ok: true, uploaded, left };
                    if (!(await stillLocal(w.term))) {
                        left--;
                        continue;
                    }
                    await addInboxWord(config, { term: w.term, context: w.context });
                }
            } catch (err) {
                const message = String(err instanceof Error ? err.message : err);
                // A term the account can never hold (longer than its limit) is
                // dropped, not retried: left at the head of the queue it would
                // block every word behind it at every trigger, for good.
                if (message.startsWith('term must be')) {
                    await removeLocalWord(w.term);
                    left--;
                    continue;
                }
                if (isAuthFailure(err)) {
                    // No session left at all: the learner signed out while this
                    // write was being prepared. That is not a dead session.
                    if (!(await getAuthState())) return { ok: true, uploaded, left };
                    await endSession();
                    await setNeedsReauthBadge();
                }
                return { ok: false, uploaded, left, error: message };
            }
            await removeLocalWord(w.term);
            await setMirrorEntry(w.term, 'active');
            uploaded++;
            left--;
        }
        return { ok: true, uploaded, left };
    } catch (err) {
        return { ok: false, uploaded, left, error: String(err instanceof Error ? err.message : err) };
    }
}

/**
 * A dev build's chosen backend, restored once per worker. Every path that
 * talks to Firebase awaits it: a worker woken by a message that is not an auth
 * one (the Google Translate import, say) would otherwise run on the build's
 * default target, the local emulators, until some auth message came along.
 * Nothing in a release build.
 */
export function devEnvReady(): Promise<void> {
    if (__EXT_ENV__ !== 'dev') return Promise.resolve();
    envRestored ??= restoreEnv();
    return envRestored;
}

export async function handleAuthMessage(
    request: AuthMessage,
    sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
    await devEnvReady();
    switch (request.action as AuthAction) {
        case 'AUTH_STATUS': {
            const state = await getAuthState();
            const inboxCount = await activeWordCount();
            const localCount = await countLocalWords();
            const needsReauth = await getNeedsReauth();
            return state
                ? { signedIn: true, email: state.email, uid: state.uid, inboxCount, localCount, needsReauth }
                : { signedIn: false, inboxCount, localCount, needsReauth };
        }
        case 'LOCAL_WORDS_LIST': {
            return { ok: true, words: await listLocalWords() };
        }
        case 'LOCAL_WORD_SET_TRANSLATION': {
            const term = String(request.term ?? '').trim();
            if (!term) throw new Error('term required');
            await setLocalTranslation(term, typeof request.translation === 'string' ? request.translation : '');
            return { ok: true };
        }
        case 'AUTH_SIGN_IN_VIA_LINGOGRAM': {
            const extId = chrome.runtime.id;
            // Fresh one-shot challenge: SPA reads it from the URL and echoes
            // it in the handoff payload, so an XSS in a trusted-origin tab
            // that we did NOT open can't push a token at us (it doesn't know
            // the value). Stored in chrome.storage.session because the MV3
            // service worker may recycle before the user finishes signing in.
            const nonce = crypto.randomUUID();
            await setPendingAuthNonce(nonce);
            // Which surface sent the user here — the popup, the in-page badge,
            // or the player menu. Signed-out saves are a suspected funnel hole,
            // so knowing which prompt actually converts is the point.
            void track('signin_started', { from: String(request.from ?? 'unknown') });
            const url =
                `${config.frontendBaseUrl}/extension-auth` +
                `?ext=${encodeURIComponent(extId)}` +
                `&nonce=${encodeURIComponent(nonce)}`;
            await chrome.tabs.create({ url });
            return { ok: true };
        }
        case 'OPEN_LINGOGRAM': {
            // Plain visit to the signed-in site (saved words, profile, sign-out)
            // — no nonce, no handoff: that's AUTH_SIGN_IN_VIA_LINGOGRAM's job.
            // Lives here because chrome.tabs is background-only; the player menu
            // is a content script and can't open a tab itself.
            await chrome.tabs.create({ url: config.frontendBaseUrl });
            return { ok: true };
        }
        case 'OPEN_EXTENSION_PAGE': {
            // The "running twice" banner's way out: the other copy's details
            // page, where its on/off switch is. A page cannot open chrome://
            // URLs; the worker can. The id comes from the page's DOM, so it is
            // checked to be an extension id before it goes into a URL.
            const id = String(request.id ?? '');
            if (!/^[a-p]{32}$/.test(id)) throw new Error('bad extension id');
            await chrome.tabs.create({ url: `chrome://extensions/?id=${id}` });
            return { ok: true };
        }
        case 'AUTH_SIGN_OUT': {
            await endSession();
            // Dev builds park one session per backend so the switch does not
            // cost a sign-in (see storage.parkAuthState). An explicit sign-out
            // has to reach those too: leaving them would make "signed out"
            // untrue the moment the badge is clicked. Folds away in prod,
            // where nothing is ever parked.
            await clearParkedAuthStates();
            // The stamps are module state, so `clearAuthState` cannot reach
            // them: without this the signed-out account's terms stay in worker
            // memory until the worker recycles.
            localWrites.clear();
            emptyFullSyncUid = null;
            await clearNeedsReauthBadge();
            return { ok: true };
        }
        case 'ADD_WORD': {
            const term = String(request.term ?? '').trim();
            const context = typeof request.context === 'string' ? request.context : '';
            if (!term) throw new Error('term required');
            const input = { term, context };
            // Every save funnels through here from all three extensions, so the
            // attempt/success pair is measured in one place. The attempt is
            // recorded before the write so failed saves show up too. `site` is
            // the coarse platform label from the caller; the saved word itself
            // is never a parameter (deny-list in analytics.ts).
            const site = String(request.site ?? '');
            const auth = await getAuthState();
            const signedIn = !!auth;
            // The language pair rides on both events so attempt/saved rows are
            // sliceable by the same dimensions. Read from storage rather than
            // taken from the caller: the web edition's context menu has no
            // langPrefs of its own, and storage is the single source of truth.
            const prefs = await loadLanguagePrefs();
            const learning = prefs?.learning ?? '';
            const native = prefs?.native ?? '';
            void track('word_save_attempt', { site, signed_in: signedIn, learning, native });
            // Stamped BEFORE the commit goes out, so a sync issued after this
            // point knows the term changed locally and leaves it alone. A stamp
            // taken after the response would lose exactly the race it exists
            // for: the sync that started while this write was in flight.
            stampLocalWrite(term);

            // Kept in the browser, and the mirror says so at once: the heart
            // and the page highlight read the mirror, not the local store. The
            // reply is the same shape as a saved one plus `local: true`, so a
            // caller that only checks `ok` needs no change.
            const saveLocally = async (): Promise<unknown> => {
                // The same limit the account write applies, before the word is
                // kept: otherwise it is "saved", and dropped at the upload.
                assertTermFits(term);
                await addLocalWord({ term, context, site });
                await setMirrorEntry(term, 'active');
                const done = await afterSave(request, { site, signedIn: false, learning, native });
                return { ok: true, local: true, inboxCount: done.inboxCount, promptRate: done.promptRate };
            };
            if (!signedIn) return await saveLocally();

            const diag = DIAG_BUILD && request.diag === true ? createWorkerDiag(auth) : undefined;
            try {
                const r = await addInboxWord(config, input, { diag });
                // Marked here as well as by the caller: the quick-add overlay
                // marks the word before asking, the context menu only after the
                // reply, and the count in this reply must include it either way.
                await setMirrorEntry(term, 'active');
                const done = await afterSave(request, { site, signedIn: true, learning, native });
                // A save that went through is proof the account is reachable
                // and under its limits: the cheapest moment to carry on with
                // words that did not make it earlier.
                void uploadLocalWords();
                return {
                    ok: true,
                    wordId: r.wordId,
                    inboxCount: done.inboxCount,
                    promptRate: done.promptRate,
                    ...(DIAG_BUILD && diag ? { diag: diag.done() } : {}),
                };
            } catch (err) {
                if (DIAG_BUILD && diag) attachDiag(err, diag.done(err));
                // Refresh-token revoked / Firestore rejected the token —
                // wipe state and prompt the user to re-authorize via a
                // normal visible tab. No silent recovery: the scoped
                // session is gone and a fresh handoff is the only path.
                //
                // The word is not lost with it: it is kept in the browser and
                // moves into the account after the next sign-in. Only THIS
                // classification does that. A refusal by the rules (the
                // interval, the daily cap) is not a dead session and still
                // throws, so the caller shows its failure and the learner can
                // retry in the account.
                if (isAuthFailure(err)) {
                    await endSession();
                    await setNeedsReauthBadge();
                    return await saveLocally();
                }
                throw err;
            }
        }
        case 'REMOVE_WORD': {
            const term = String(request.term ?? '').trim();
            if (!term) throw new Error('term required');
            const site = String(request.site ?? '');
            const auth = await getAuthState();
            const signedIn = !!auth;
            const prefs = await loadLanguagePrefs();
            const learning = prefs?.learning ?? '';
            const native = prefs?.native ?? '';
            stampLocalWrite(term);
            if (!signedIn) {
                // Nothing to tell an account: the word only ever lived here.
                await removeLocalWord(term);
                await setMirrorEntry(term, 'removed');
                const inboxCount = await activeWordCount();
                void track('word_removed', { site, signed_in: false, learning, native });
                return { ok: true, local: true, state: 'removed', inboxCount };
            }
            const diag = DIAG_BUILD && request.diag === true ? createWorkerDiag(auth) : undefined;
            try {
                const r = await removeInboxWord(config, { term }, { diag });
                // A copy still waiting in the browser would otherwise upload
                // later and bring the word back.
                await removeLocalWord(term);
                // Marked here as well as by the caller, so the count in this
                // reply is what is left whoever sent the removal.
                await setMirrorEntry(term, 'removed');
                const inboxCount = await activeWordCount();
                void track('word_removed', { site, signed_in: signedIn, learning, native });
                return {
                    ok: true,
                    state: r.state,
                    inboxCount,
                    ...(DIAG_BUILD && diag ? { diag: diag.done() } : {}),
                };
            } catch (err) {
                if (DIAG_BUILD && diag) attachDiag(err, diag.done(err));
                // Deliberately NOT the ADD_WORD catch. A removal has no benign
                // 403 left to interpret — removeInboxWord already reports the
                // two "already not saved" refusals as success — so anything
                // reaching here is a real failure and is classified exactly as
                // a failed save would be.
                if (isAuthFailure(err)) {
                    await endSession();
                    await setNeedsReauthBadge();
                }
                throw err;
            }
        }
        case 'SYNC_WORDS': {
            return await syncWords();
        }
        case 'TRACK_EVENT': {
            // Usage analytics relayed from a content script or the popup.
            // Fire-and-forget by construction: handleTrackMessage never
            // rejects, and the opt-out gate lives inside track() so this
            // handler cannot bypass it. Same posture as REPORT_NO_SUBS —
            // nobody is watching the result. The sender lets the handler
            // derive a fallback `site` from the tab for site-bearing events.
            return handleTrackMessage(request, sender);
        }
        case 'REPORT_NO_SUBS': {
            // Best-effort diagnostics from the emergency "Reload page" button —
            // the page is about to reload, nobody is watching the result. Swallow
            // every failure (signed-out user, rules rejection, network): a report
            // must never surface an error or touch the auth state / badge.
            const videoRef = String(request.videoRef ?? '');
            if (!videoRef) return { ok: false };
            try {
                await addNoSubsReport(config, {
                    site: String(request.site ?? ''),
                    videoRef,
                    version: String(request.version ?? ''),
                    locale: String(request.locale ?? ''),
                    learning: String(request.learning ?? ''),
                    native: String(request.native ?? ''),
                    // Optional: a caller that predates these fields still works.
                    failure: String(request.failure ?? ''),
                    status: Number(request.status ?? 0),
                    attempts: Number(request.attempts ?? 0),
                    tracksLoaded: Number(request.tracksLoaded ?? 0),
                });
                return { ok: true };
            } catch {
                return { ok: false };
            }
        }
        case 'SEND_FEEDBACK': {
            // Free text from the rating prompt's "not really" branch. Runs
            // signed out too — see addFeedback. The card reports success or
            // failure to the user (unlike REPORT_NO_SUBS, which nobody is
            // watching), so the result is returned rather than swallowed.
            const text = String(request.text ?? '').trim();
            if (!text) return { ok: false };
            try {
                await addFeedback(config, {
                    text,
                    site: String(request.site ?? ''),
                    version: String(request.version ?? ''),
                    locale: String(request.locale ?? ''),
                });
                return { ok: true };
            } catch (err) {
                console.warn('[Lingogram] feedback failed:', err);
                return { ok: false };
            }
        }
        case 'GET_NOTIFICATION': {
            // Anonymous read of the public notifications collection. Lives in
            // the worker rather than the content script so the network call
            // sits behind the same boundary as every other one.
            //
            // getNotification never rejects — it resolves to stale cache or
            // null on any failure. The try is a backstop, and it deliberately
            // does NOT clear auth state or set the re-auth badge the way
            // ADD_WORD does: this request carries no token, so a 401 from it
            // says nothing about the user's session.
            try {
                const notification = await getNotification({
                    version: String(request.version ?? ''),
                    platform: String(request.platform ?? ''),
                    source: config.source,
                    locale: String(request.locale ?? ''),
                });
                return { ok: true, notification };
            } catch (err) {
                console.debug('[Lingogram] notification lookup failed:', err);
                return { ok: true, notification: null };
            }
        }
        case 'SUBTITLE_AI_PART':
        case 'SUBTITLE_AI_STORE': {
            // Server-side subtitle translation (english spec 023). Authed, so it
            // runs here where the token lives; outcomes are values, never throws.
            if (!config.apiBaseUrl) return { ok: false, code: 'unavailable' };
            const deps = { fetch: (u: string, i: RequestInit) => fetch(u, i), token: (r: boolean) => freshIdToken(config, r), now: Date.now };
            return request.action === 'SUBTITLE_AI_PART'
                ? requestPart(config, request.part as PartRequest, deps)
                : storeTrack(config, request.track as StoredTrack, deps);
        }
        case 'LOOKUP_WORD': {
            // Anonymous word lookup for the hover strip and the sidebar's word
            // screen. Runs here rather than in the content script because the
            // edge's CORS allow-list has no chrome-extension:// origin — a page
            // fetch dies on the preflight, while the worker (host-permitted,
            // no Origin) goes straight through.
            //
            // No auth, no retry, no badge: the route is public, and a miss is
            // answered by the next hover. An unconfigured build (no
            // EXT_API_BASE_URL) reports ok:false once per call and stays quiet.
            const term = String(request.term ?? '').trim();
            const targetLang = String(request.targetLang ?? '').trim();
            if (!term || !targetLang) return { ok: false, error: 'term and targetLang required' };
            // The selection path caps length before it calls, but the hover
            // path reads span.dataset.word straight off the page — and a
            // third-party subtitle track sets that. Refuse here too, where
            // every caller passes, rather than trusting each call site.
            if (term.length > MAX_LOOKUP_TERM_LEN) return { ok: false, error: 'term too long' };
            // A phrase goes to Google first, from the user's own IP, and only
            // falls back to the service (lookupPhraseCached) — so a build with
            // no API still translates phrases. A word has no path without it.
            const phrase = isPhrase(term);
            if (!phrase && !config.apiBaseUrl) return { ok: false, error: 'lookup not configured' };
            const context = typeof request.context === 'string' ? request.context : '';
            // Two sizes: the strip wants one sense (~2 KB, not the 41 KB a
            // full "running" entry weighs), the word screen wants a readable
            // article.
            const level = request.detail === true ? 'detail' : 'strip';
            const limits = level === 'strip'
                ? { maxPartsOfSpeech: 3, maxSenses: 1, maxExamples: 0 }
                : { maxPartsOfSpeech: 3, maxSenses: 3, maxExamples: 1 };
            const site = String(request.site ?? '');
            const started = Date.now();
            try {
                const { result, cached } = await (phrase ? lookupPhraseCached : lookupCached)(
                    config.apiBaseUrl,
                    { term, targetLang, context, ...limits },
                    level !== 'strip',
                );
                // Shape only — the deny-list in analytics.ts would strip the
                // word anyway, so it is never offered. `source` is what drives
                // the dictionary/model/cache mix decision on the server side.
                void track('word_lookup', {
                    site,
                    level,
                    source: cached ? 'cache' : (result.source || 'empty'),
                    empty: !hasLookupContent(result),
                    latency_bucket: latencyBucket(Date.now() - started),
                });
                return { ok: true, result };
            } catch (err) {
                void track('word_lookup', {
                    site,
                    level,
                    source: 'error',
                    latency_bucket: latencyBucket(Date.now() - started),
                });
                return { ok: false, error: String(err instanceof Error ? err.message : err) };
            }
        }
        case 'DISMISS_NOTIFICATION': {
            try {
                await dismissNotification(String(request.id ?? ''));
            } catch {
                /* the banner is already closed; the record is best-effort */
            }
            return { ok: true };
        }
        default: {
            // Dev-only actions live in their own module so their very NAMES
            // stay out of prod bundles: a `case 'DEV_SET_ENV'` here would
            // survive minification as a dead branch, advertising the mechanism
            // even though its body was stripped. The guard folds to false in
            // prod and the import is never emitted.
            if (__EXT_ENV__ === 'dev') {
                const handled = await handleDevAction(request);
                if (handled) return handled.result;
            }
            throw new Error(`unknown action: ${request.action}`);
        }
    }
}

interface ExternalAuthPayload {
    customToken?: unknown;
    email?: unknown;
    uid?: unknown;
    // Echo of the one-shot challenge the extension placed in the auth URL
    // when it opened the tab. Required — handoffs without a matching nonce
    // are rejected to block XSS-initiated unsolicited token pushes.
    nonce?: unknown;
}

interface ExternalAuthMessage {
    type?: unknown;
    payload?: ExternalAuthPayload;
}

// Derived from the build-time frontend URL so a staging deploy (EXT_FRONTEND_BASE_URL=...)
// stays accepted. For Firebase Hosting `.web.app` sites the `.firebaseapp.com` mirror
// is added automatically. The manifest's externally_connectable.matches must list the
// same hosts — Chrome filters by that first, this is a belt-and-braces re-check.
export function buildAllowedExternalOrigins(baseUrl: string): ReadonlySet<string> {
    const origins = new Set<string>();
    try {
        const url = new URL(baseUrl);
        origins.add(url.origin);
        if (url.hostname.endsWith('.web.app')) {
            const mirror = url.hostname.replace(/\.web\.app$/, '.firebaseapp.com');
            origins.add(`${url.protocol}//${mirror}`);
        } else if (url.hostname.endsWith('.firebaseapp.com')) {
            const mirror = url.hostname.replace(/\.firebaseapp\.com$/, '.web.app');
            origins.add(`${url.protocol}//${mirror}`);
        }
    } catch {
        // Malformed baseUrl — origin set stays empty so handoffs are rejected.
    }
    return origins;
}

export function isAllowedExternalSender(sender: chrome.runtime.MessageSender): boolean {
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
    if (!origin) return false;
    // Every frontend this build can be handed a token by, not just the side the
    // worker is pointed at: the user opens whichever site they are testing and
    // the handoff arrives before the badge is ever touched. A prod build has
    // one entry here, exactly as before.
    return switchableFrontendBaseUrls().some((baseUrl) =>
        buildAllowedExternalOrigins(baseUrl).has(origin),
    );
}

export function installExternalAuthHandoff(): void {
    chrome.runtime.onMessageExternal.addListener((message: ExternalAuthMessage, sender, sendResponse) => {
        // The other edition's menu ping has its own listener (context-menu-save.ts).
        // Answering it here would beat that listener to sendResponse with a refusal.
        if (isSiblingMessage(message)) return false;
        // The welcome page on the site has its own listener (welcome/bridge.ts).
        if ((message as { type?: unknown } | undefined)?.type === 'lingogram-welcome') return false;
        // Likewise the settings page (settings-bridge.ts).
        if ((message as { type?: unknown } | undefined)?.type === 'lingogram-settings') return false;
        if (!isAllowedExternalSender(sender)) {
            sendResponse({ ok: false, error: 'unauthorized origin' });
            return false;
        }
        if (message?.type !== 'lingogram-extension-auth') {
            sendResponse({ ok: false, error: 'unknown message type' });
            return false;
        }
        const p = message.payload ?? {};
        const customToken = typeof p.customToken === 'string' ? p.customToken : '';
        const email = typeof p.email === 'string' ? p.email : '';
        const uid = typeof p.uid === 'string' ? p.uid : '';
        const nonce = typeof p.nonce === 'string' ? p.nonce : '';
        if (!customToken || !uid) {
            sendResponse({ ok: false, error: 'customToken and uid required' });
            return false;
        }
        (async () => {
            // Validate the pending nonce up front but DON'T clear yet — a
            // transient exchange failure (network blip, CREDENTIAL_MISMATCH
            // during a backend rollout, etc.) would otherwise burn the nonce
            // and force the user back through the popup. We clear only after
            // the entire handoff has succeeded.
            const nonceOk = await validatePendingAuthNonce(nonce);
            if (!nonceOk) {
                sendResponse({
                    ok: false,
                    error:
                        'invalid or expired auth challenge — open the extension popup ' +
                        'and start the sign-in flow from there',
                });
                return;
            }
            try {
                // Exchange the scoped Firebase custom token for our own
                // id+refresh pair. The `scopes` claim rides along through
                // refresh, so the extension stays restricted to inbox writes
                // even after the initial id token expires.
                const exchanged = await exchangeCustomToken(config, customToken, uid);
                await setAuthState({
                    idToken: exchanged.idToken,
                    refreshToken: exchanged.refreshToken,
                    expiresAt: exchanged.expiresAt,
                    email,
                    uid: exchanged.uid,
                });
                // Success — burn the nonce so the same URL can't be replayed.
                await clearPendingAuthNonce();
                await clearNeedsReauthBadge();
                sendResponse({ ok: true });
                // Fill the mirror now: the popup's count and the page
                // highlight read it, and nothing else would sync it until some
                // page woke the worker. Then move the words kept in the browser
                // into the account. Neither rejects, so no catch.
                void syncWords({ force: true }).then(() => uploadLocalWords());
            } catch (err) {
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
            }
        })();
        return true;
    });
}

export function installAuthMessageHandler(): void {
    chrome.runtime.onMessage.addListener((request: AuthMessage, sender, sendResponse) => {
        if (!isAuthAction(request?.action)) return false;
        (async () => {
            try {
                const result = await handleAuthMessage(request, sender);
                sendResponse(result);
            } catch (err) {
                console.error('Background auth handler error:', err);
                sendResponse({
                    ok: false,
                    error: String(err instanceof Error ? err.message : err),
                    ...(DIAG_BUILD ? diagOf(err) : {}),
                });
            }
        })();
        return true;
    });
}

// One-shot migration: installs that signed in before the scoped-token rollout
// have `refreshToken === ''` and rely on the now-removed silent reauth path.
// Wipe their cached state on startup so the next ADD_WORD asks the user to
// re-authorize through the normal visible tab instead of failing silently.
export async function migrateLegacyAuthState(): Promise<void> {
    const state = await getAuthState();
    if (state && !state.refreshToken) {
        await endSession();
        await setNeedsReauthBadge();
    }
}

export function installAuthBackground(): void {
    installAuthMessageHandler();
    installExternalAuthHandoff();
    void migrateLegacyAuthState().then(restoreLocalState, restoreLocalState);
    // (a) Worker wake. Fire-and-forget beside the migration: a wake is the
    // cheapest moment to notice what another device did, and syncWords never
    // rejects, so nothing here needs a catch.
    void syncWords();
}

/**
 * Worker start, once the session question is settled: signed out, the mirror is
 * exactly the words kept in the browser; signed in, whatever is still waiting
 * there is carried into the account.
 */
async function restoreLocalState(): Promise<void> {
    try {
        if (await getAuthState()) {
            await uploadLocalWords();
        } else {
            await setMirrorToTerms((await listLocalWords()).map((w) => w.term));
        }
    } catch (err) {
        console.warn('[Lingogram] local words restore failed:', err);
    }
}
