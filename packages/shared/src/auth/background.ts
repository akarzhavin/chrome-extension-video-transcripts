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
import { MAX_LOOKUP_TERM_LEN, hasLookupContent, latencyBucket, lookupCached } from '../lookup';
import { exchangeCustomToken } from './firebaseRest';
import { addFeedback, addInboxWord, addNoSubsReport, listInboxWords, removeInboxWord } from './firestoreRest';
import { applySyncedDocs, loadMirror } from '../word-mirror';
import { normalizeTerm } from '../word-key';
import { loadLanguagePrefs } from '../languages';
// Relative, like analytics-bg above and for the same reason: notifications.ts
// imports analytics-bg to report fetch failures, so it carries the api_secret
// transitively and must stay out of anything a content script can pull in.
import { dismissNotification, getNotification } from '../notifications';
import {
    bumpInboxCount,
    bumpSavedWordCount,
    clearAuthState,
    clearPendingAuthNonce,
    getAuthState,
    getInboxCount,
    getRatePromptShown,
    markRatePromptShown,
    RATE_PROMPT_WORD_THRESHOLD,
    setAuthState,
    setPendingAuthNonce,
    validatePendingAuthNonce,
} from './storage';

export type AuthAction =
    | 'AUTH_STATUS'
    | 'AUTH_SIGN_IN_VIA_LINGOGRAM'
    | 'AUTH_SIGN_OUT'
    | 'OPEN_LINGOGRAM'
    | 'ADD_WORD'
    | 'REMOVE_WORD'
    | 'SYNC_WORDS'
    | 'REPORT_NO_SUBS'
    | 'SEND_FEEDBACK'
    | 'TRACK_EVENT'
    | 'GET_NOTIFICATION'
    | 'DISMISS_NOTIFICATION'
    | 'LOOKUP_WORD'
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
    'ADD_WORD',
    // Both here AND in the union above. A name in one only passes
    // type-checking and is then dropped by isAuthAction with no error: the
    // message is never handled and the caller's promise never settles.
    'REMOVE_WORD',
    'SYNC_WORDS',
    'REPORT_NO_SUBS',
    'SEND_FEEDBACK',
    'TRACK_EVENT',
    'GET_NOTIFICATION',
    'DISMISS_NOTIFICATION',
    'LOOKUP_WORD',
]);

export function isAuthAction(action: unknown): action is AuthAction {
    if (typeof action !== 'string') return false;
    if ((AUTH_ACTIONS as ReadonlySet<string>).has(action)) return true;
    // Dev actions are matched by prefix rather than by name, so no dev action
    // string appears in a prod bundle. Folds away entirely in prod builds.
    return __EXT_ENV__ === 'dev' && action.startsWith('DEV_');
}

export interface AuthMessage {
    action: string;
    [k: string]: unknown;
}

// Surface "the extension needs to be re-authorized" via the toolbar badge.
// Refresh-token failures (revoked session, very long inactivity) now require
// the user to open a normal /extension-auth tab — no silent recovery path.
function setNeedsReauthBadge(): void {
    try {
        chrome.action?.setBadgeText({ text: '!' });
        chrome.action?.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } catch {
        // chrome.action unavailable in some test contexts; silent ignore.
    }
}

function clearNeedsReauthBadge(): void {
    try {
        chrome.action?.setBadgeText({ text: '' });
    } catch {
        // see setNeedsReauthBadge.
    }
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

export async function syncWords(): Promise<SyncResult> {
    if (inFlight) return inFlight;
    if (Date.now() - lastFinishedAt < SYNC_COOLDOWN_MS) return { ok: true, applied: 0, full: false };
    inFlight = runSync().finally(() => {
        inFlight = null;
        lastFinishedAt = Date.now();
    });
    return inFlight;
}

export async function handleAuthMessage(
    request: AuthMessage,
    sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
    if (__EXT_ENV__ === 'dev') {
        envRestored ??= restoreEnv();
        await envRestored;
    }
    switch (request.action as AuthAction) {
        case 'AUTH_STATUS': {
            const state = await getAuthState();
            const inboxCount = await getInboxCount();
            return state
                ? { signedIn: true, email: state.email, uid: state.uid, inboxCount }
                : { signedIn: false, inboxCount };
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
        case 'AUTH_SIGN_OUT': {
            await clearAuthState();
            // The stamps are module state, so `clearAuthState` cannot reach
            // them: without this the signed-out account's terms stay in worker
            // memory until the worker recycles.
            localWrites.clear();
            emptyFullSyncUid = null;
            clearNeedsReauthBadge();
            return { ok: true };
        }
        case 'ADD_WORD': {
            const term = String(request.term ?? '').trim();
            const context = typeof request.context === 'string' ? request.context : '';
            if (!term) throw new Error('term required');
            const input = { term, context };
            // Every save funnels through here from all three extensions, so the
            // attempt/success pair is measured in one place. The attempt is
            // recorded before the write so signed-out and failed saves show up
            // too — the gap between the two is the "sign in to save" funnel
            // hole. `site` is the coarse platform label from the caller; the
            // saved word itself is never a parameter (deny-list in analytics.ts).
            const site = String(request.site ?? '');
            const signedIn = !!(await getAuthState());
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
            try {
                const r = await addInboxWord(config, input);
                const inboxCount = await bumpInboxCount();
                // Value-moment rating prompt (P1.8): once this install crosses
                // the saved-word threshold, ask for a store rating — exactly
                // once, ever. The content script renders the actual banner when
                // it sees promptRate; here we only decide + burn the one-shot.
                const savedWordCount = await bumpSavedWordCount();
                let promptRate = false;
                if (savedWordCount >= RATE_PROMPT_WORD_THRESHOLD && !(await getRatePromptShown())) {
                    await markRatePromptShown();
                    promptRate = true;
                }
                // The funnel's terminal step. saved_count is this install's
                // running total, which is what makes "how many people reach
                // their 5th / 30th word" answerable.
                void track('word_saved', {
                    site,
                    saved_count: savedWordCount,
                    signed_in: signedIn,
                    learning,
                    native,
                });
                return { ok: true, wordId: r.wordId, inboxCount, promptRate };
            } catch (err) {
                // Refresh-token revoked / Firestore rejected the token —
                // wipe state and prompt the user to re-authorize via a
                // normal visible tab. No silent recovery: the scoped
                // session is gone and a fresh handoff is the only path.
                if (isAuthFailure(err)) {
                    await clearAuthState();
                    setNeedsReauthBadge();
                }
                throw err;
            }
        }
        case 'REMOVE_WORD': {
            const term = String(request.term ?? '').trim();
            if (!term) throw new Error('term required');
            const site = String(request.site ?? '');
            const signedIn = !!(await getAuthState());
            const prefs = await loadLanguagePrefs();
            const learning = prefs?.learning ?? '';
            const native = prefs?.native ?? '';
            stampLocalWrite(term);
            try {
                const r = await removeInboxWord(config, { term });
                // The inbox count is the learner's own tally of saved words, so
                // a removal walks it back. It never goes below zero: a removal
                // of a word this install never counted (saved on another
                // device) would otherwise leave a negative badge.
                const inboxCount = await bumpInboxCount(-1);
                void track('word_removed', { site, signed_in: signedIn, learning, native });
                return { ok: true, state: r.state, inboxCount };
            } catch (err) {
                // Deliberately NOT the ADD_WORD catch. A removal has no benign
                // 403 left to interpret — removeInboxWord already reports the
                // two "already not saved" refusals as success — so anything
                // reaching here is a real failure and is classified exactly as
                // a failed save would be.
                if (isAuthFailure(err)) {
                    await clearAuthState();
                    setNeedsReauthBadge();
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
            if (!config.apiBaseUrl) return { ok: false, error: 'lookup not configured' };
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
                const { result, cached } = await lookupCached(
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

function isAllowedExternalSender(sender: chrome.runtime.MessageSender): boolean {
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
                clearNeedsReauthBadge();
                sendResponse({ ok: true });
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
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
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
        await clearAuthState();
        setNeedsReauthBadge();
    }
}

export function installAuthBackground(): void {
    installAuthMessageHandler();
    installExternalAuthHandoff();
    void migrateLegacyAuthState();
    // (a) Worker wake. Fire-and-forget beside the migration: a wake is the
    // cheapest moment to notice what another device did, and syncWords never
    // rejects, so nothing here needs a catch.
    void syncWords();
}
