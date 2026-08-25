// Remote notifications: a message we can put in the sidebar without shipping a
// release. The case this exists for is an upstream site changing something that
// breaks subtitle discovery — users see "no subtitles" and have no way to learn
// that we know and are fixing it. A CWS release takes days; this takes minutes.
//
// Transport is a plain anonymous GET against a world-readable Firestore
// collection (`allow read: if true` in infrastructure/firestore.rules.tmpl).
// Deliberately NOT in auth/firestoreRest.ts: every call there is built around
// `Bearer ${idToken}` and a signed-in uid, and this one must work for
// signed-out users — which is most of them at the moment a site breaks.
//
// SERVICE-WORKER ONLY. This module imports analytics-bg (GA4 api_secret) to
// report fetch failures, so it must never be pulled into a content-script
// bundle, and it is deliberately absent from the package barrel — same rule,
// and for the same reason, as analytics-bg itself. Content scripts get the
// result over chrome.runtime messaging and the types from ./notification-types.
//
// The hard requirement running through the whole file: a failure here is
// invisible. The notification channel going down must never cost a user their
// subtitles, so every path swallows, reports, and returns null.

import { config } from './auth/config';
import { NOTIFICATION_KEYS } from './auth/storage';
import { track } from './analytics-bg';
import {
    isNotificationSeverity,
    NotificationQuery,
    RemoteNotification,
} from './notification-types';

// 15 minutes. The trade is delivery latency during an outage against a read per
// user per interval; at 15 min a fix announcement reaches everyone within a
// quarter hour and each install costs at most ~96 reads/day.
const CACHE_TTL_MS = 15 * 60 * 1000;

// After a failure, wait this long before trying again. Without it a Firestore
// outage turns into a request on every video the user opens.
const RETRY_BACKOFF_MS = 15 * 60 * 1000;

// A hung request must not keep the MV3 service worker alive.
const FETCH_TIMEOUT_MS = 5_000;

// Key names live in auth/storage.ts, which is the declared single inventory of
// extension storage keys that the privacy policy documents.
const STORAGE_KEYS = NOTIFICATION_KEYS;

/** Why a fetch failed. Closed set — see the note in reportFailure(). */
type FailureReason = 'network' | 'timeout' | 'http' | 'parse';

// ---------------------------------------------------------------------------
// Firestore typed-value decoding
// ---------------------------------------------------------------------------
//
// The REST API wraps every field in a type tag ({stringValue}, {arrayValue},
// …). auth/firestoreRest.ts decodes integerValue inline and types nothing else,
// so there is no decoder to reuse. These take `unknown` and return a usable
// value or a default: a malformed document degrades field by field instead of
// throwing, which matters because the documents are hand-written in the
// Firebase Console and a typo must not take out the whole channel.

interface TypedValue {
    stringValue?: string;
    booleanValue?: boolean;
    integerValue?: string;
    arrayValue?: { values?: unknown[] };
    mapValue?: { fields?: Record<string, unknown> };
}

function asTyped(v: unknown): TypedValue {
    return v && typeof v === 'object' ? (v as TypedValue) : {};
}

function decodeString(v: unknown): string {
    const s = asTyped(v).stringValue;
    return typeof s === 'string' ? s : '';
}

function decodeBool(v: unknown): boolean {
    return asTyped(v).booleanValue === true;
}

function decodeInt(v: unknown): number {
    const n = parseInt(asTyped(v).integerValue ?? '', 10);
    return Number.isFinite(n) ? n : 0;
}

function decodeStringArray(v: unknown): string[] {
    const values = asTyped(v).arrayValue?.values;
    if (!Array.isArray(values)) return [];
    return values.map(decodeString).filter((s) => s !== '');
}

function decodeStringMap(v: unknown): Record<string, string> {
    const fields = asTyped(v).mapValue?.fields;
    if (!fields || typeof fields !== 'object') return {};
    // Null-prototype: these maps are keyed by a language tag that ultimately
    // comes from outside this module, and a lookup for 'constructor' or
    // 'toString' on a normal object returns something that is not a string.
    const out: Record<string, string> = Object.create(null);
    for (const [k, raw] of Object.entries(fields)) {
        const s = decodeString(raw);
        if (s !== '') out[k] = s;
    }
    return out;
}

/** A notification document, decoded but not yet resolved for a user. */
export interface NotificationDoc {
    id: string;
    active: boolean;
    severity: string;
    platforms: string[];
    sources: string[];
    locales: string[];
    minVersion: string;
    maxVersion: string;
    expiresAt: string;
    dismissible: boolean;
    priority: number;
    title: Record<string, string>;
    body: Record<string, string>;
}

interface RawDocument {
    name?: string;
    fields?: Record<string, unknown>;
}

/** Last path segment of a Firestore document `name`. */
function docIdFromName(name: string): string {
    const parts = String(name || '').split('/');
    return parts[parts.length - 1] ?? '';
}

export function decodeNotificationDoc(raw: RawDocument): NotificationDoc | null {
    const id = docIdFromName(raw?.name ?? '');
    if (!id) return null;
    const f = raw.fields ?? {};
    return {
        id,
        active: decodeBool(f.active),
        severity: decodeString(f.severity),
        platforms: decodeStringArray(f.platforms),
        sources: decodeStringArray(f.sources),
        locales: decodeStringArray(f.locales),
        minVersion: decodeString(f.minVersion),
        maxVersion: decodeString(f.maxVersion),
        expiresAt: decodeString(f.expiresAt),
        dismissible: decodeBool(f.dismissible),
        priority: decodeInt(f.priority),
        title: decodeStringMap(f.title),
        body: decodeStringMap(f.body),
    };
}

// ---------------------------------------------------------------------------
// Pure selection logic
// ---------------------------------------------------------------------------

/**
 * Numeric dotted-version compare. Returns <0, 0, >0.
 *
 * String comparison is wrong here in a way that bites immediately: '1.0.9' >
 * '1.0.16' lexicographically, so a maxVersion of 1.0.16 would exclude the very
 * build we most want to reach. Missing segments count as 0 ('1.1' === '1.1.0').
 */
export function compareVersions(a: string, b: string): number {
    const pa = String(a || '').split('.');
    const pb = String(b || '').split('.');
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = parseInt(pa[i] ?? '0', 10) || 0;
        const nb = parseInt(pb[i] ?? '0', 10) || 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}

/**
 * Text for `locale` from a language map: exact match, then the base language of
 * a regional tag ('pt-BR' → 'pt'), then English.
 *
 * Returns '' when even 'en' is missing — callers treat that as "skip this
 * document" rather than rendering an empty banner. English is therefore the
 * required key, and filling in only English is a complete notification: every
 * locale falls through to it.
 */
export function pickLocalized(map: Record<string, string>, locale: string): string {
    if (!map || typeof map !== 'object') return '';
    // Own string properties only. decodeStringMap already builds null-prototype
    // maps, but this is exported and a caller may pass an object literal, where
    // 'constructor' would otherwise resolve to a function.
    const at = (k: string): string =>
        Object.prototype.hasOwnProperty.call(map, k) && typeof map[k] === 'string' ? map[k] : '';
    const want = String(locale || '').replace('_', '-');
    return at(want) || at(want.split('-')[0]) || at('en');
}

/** Empty list means "no restriction"; otherwise `value` must be a member. */
function matchesList(list: string[], value: string): boolean {
    if (!list.length) return true;
    return list.includes(value);
}

function matchesLocale(list: string[], locale: string): boolean {
    if (!list.length) return true;
    const want = String(locale || '').replace('_', '-');
    if (list.includes(want)) return true;
    // A document targeting 'ru' should reach a 'ru-RU' browser.
    const base = want.split('-')[0];
    return base ? list.includes(base) : false;
}

/**
 * True when the document must not be shown on account of its expiry.
 *
 * `expiresAt` is REQUIRED. A missing or unparseable one counts as expired, so
 * the failure mode of a malformed document is a banner nobody sees rather than
 * one nobody can take down. Every notification therefore has a date after which
 * it is inert, which is also what lets the dismissal record be cleaned up: once
 * a document is past its expiry it can never be shown again, so remembering
 * that someone closed it stops meaning anything.
 */
function isExpired(expiresAt: string, now: number): boolean {
    if (!expiresAt) return true;
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t)) return true;
    return t <= now;
}

/**
 * The dismissal ids still worth remembering, given what the collection holds.
 *
 * A record only matters while the notification it refers to could still be
 * shown. Once the document is gone from the collection — deleted, or past its
 * expiry — remembering that someone closed it protects nothing, so it is
 * dropped. This is what keeps notif.dismissed from growing for the life of the
 * install; the required expiresAt is what makes "can no longer be shown"
 * decidable at all.
 *
 * Never forgets a dismissal for a document that is still live, so a banner the
 * user closed cannot come back.
 *
 * Pure, so the policy is testable without storage or a clock.
 */
export function pruneDismissals(
    dismissed: readonly string[],
    docs: readonly NotificationDoc[],
    now: number,
): string[] {
    const showable = new Set(docs.filter((d) => !isExpired(d.expiresAt, now)).map((d) => d.id));
    return dismissed.filter((id) => showable.has(id));
}

/**
 * Picks the one notification to show, or null.
 *
 * Pure: no network, no storage, no clock beyond the injected `now`. All the
 * addressing rules live here so they can be table-tested.
 */
export function selectNotification(
    docs: NotificationDoc[],
    query: NotificationQuery,
    now: number = Date.now(),
    dismissed: string[] = [],
): RemoteNotification | null {
    const eligible = docs.filter((d) => {
        if (!d.active) return false;
        if (isExpired(d.expiresAt, now)) return false;
        if (dismissed.includes(d.id)) return false;
        if (!matchesList(d.platforms, query.platform)) return false;
        if (!matchesList(d.sources, query.source)) return false;
        if (!matchesLocale(d.locales, query.locale)) return false;
        if (d.minVersion && compareVersions(query.version, d.minVersion) < 0) return false;
        if (d.maxVersion && compareVersions(query.version, d.maxVersion) > 0) return false;
        // A document with no English text cannot be shown to everyone it
        // targets, so it is not shown at all — a title with no body reads as a
        // rendering bug, not as a message.
        if (!pickLocalized(d.title, query.locale)) return false;
        if (!pickLocalized(d.body, query.locale)) return false;
        return true;
    });
    if (!eligible.length) return null;

    // Highest priority wins; ties break on id so the choice is stable across
    // calls (Firestore does not promise a document order).
    eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const chosen = eligible[0];

    return {
        id: chosen.id,
        severity: isNotificationSeverity(chosen.severity) ? chosen.severity : 'info',
        title: pickLocalized(chosen.title, query.locale),
        body: pickLocalized(chosen.body, query.locale),
        dismissible: chosen.dismissible,
    };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function collectionUrl(): string {
    // config.* is read at call time, never captured at import: dev builds
    // retarget projectId/apiKey at runtime via the env switch (see auth/config).
    return (
        `${config.firestoreUrl}/v1/projects/${config.projectId}` +
        `/databases/(default)/documents/notifications` +
        `?key=${encodeURIComponent(config.apiKey)}`
    );
}

/**
 * Reports a failed fetch to GA4.
 *
 * `reason` is a closed set rather than the error text on purpose: browsers
 * write those messages, so they vary by locale and Chrome version and would
 * shred GA4's per-parameter cardinality budget for no analytical gain — the
 * same reasoning that keeps platformOf() coarse. Nothing identifying is sent:
 * no url, no document id, no uid. track() applies the analytics opt-out itself.
 */
function reportFailure(reason: FailureReason, status?: number): void {
    try {
        void track('notification_fetch_failed', status ? { reason, status } : { reason });
    } catch {
        /* analytics must never be the thing that breaks this */
    }
}

async function fetchNotificationDocs(): Promise<NotificationDoc[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
        res = await fetch(collectionUrl(), { signal: controller.signal });
    } catch (err) {
        // AbortError is our own timeout firing; anything else is transport.
        const timedOut = (err as { name?: string } | null)?.name === 'AbortError';
        reportFailure(timedOut ? 'timeout' : 'network');
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        reportFailure('http', res.status);
        return null;
    }

    try {
        const body = (await res.json()) as { documents?: RawDocument[] };
        // An empty collection returns `{}` with no `documents` key — that is a
        // successful "nothing to show", not a parse failure.
        const raw = Array.isArray(body?.documents) ? body.documents : [];
        return raw
            .map(decodeNotificationDoc)
            .filter((d): d is NotificationDoc => d !== null);
    } catch {
        reportFailure('parse');
        return null;
    }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheState {
    docs: NotificationDoc[] | null;
    cachedAt: number;
    retryAfter: number;
    dismissed: string[];
}

async function readCache(): Promise<CacheState> {
    const empty: CacheState = { docs: null, cachedAt: 0, retryAfter: 0, dismissed: [] };
    try {
        const v = (await chrome.storage.local.get([
            STORAGE_KEYS.cachedAt,
            STORAGE_KEYS.cachedDocs,
            STORAGE_KEYS.retryAfter,
            STORAGE_KEYS.dismissed,
        ])) as Record<string, unknown>;
        const docs = v[STORAGE_KEYS.cachedDocs];
        const dismissed = v[STORAGE_KEYS.dismissed];
        return {
            docs: Array.isArray(docs) ? (docs as NotificationDoc[]) : null,
            cachedAt: Number(v[STORAGE_KEYS.cachedAt] ?? 0) || 0,
            retryAfter: Number(v[STORAGE_KEYS.retryAfter] ?? 0) || 0,
            dismissed: Array.isArray(dismissed) ? (dismissed as string[]).map(String) : [],
        };
    } catch {
        return empty;
    }
}

async function writeCache(
    docs: NotificationDoc[],
    now: number,
    dismissed: string[],
): Promise<void> {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEYS.cachedDocs]: docs,
            [STORAGE_KEYS.cachedAt]: now,
            // A success clears any standing backoff.
            [STORAGE_KEYS.retryAfter]: 0,
            // Garbage collection rides along with the write we were making
            // anyway: no alarm, no second storage round-trip, and it only ever
            // runs on a response we know to be complete.
            [STORAGE_KEYS.dismissed]: dismissed,
        });
    } catch {
        /* a cache we cannot write just means we refetch next time */
    }
}

async function writeBackoff(now: number): Promise<void> {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.retryAfter]: now + RETRY_BACKOFF_MS });
    } catch {
        /* nothing to do */
    }
}

// Serializes dismissal writes. chrome.storage has no atomic update, so two
// read-modify-write cycles interleaving would lose one of the ids — the second
// write is built on a list read before the first one landed. Chaining costs
// nothing (dismissals are rare and the work is a single storage round-trip) and
// removes the interleaving entirely.
let dismissalQueue: Promise<void> = Promise.resolve();

/** Records that the user closed this notification, so it never returns. */
export async function dismissNotification(id: string): Promise<void> {
    if (!id) return;
    const run = dismissalQueue.then(async () => {
        try {
            const { dismissed } = await readCache();
            if (dismissed.includes(id)) return;
            await chrome.storage.local.set({
                [STORAGE_KEYS.dismissed]: [...dismissed, id],
            });
        } catch {
            /* worst case the banner reappears; never worth throwing over */
        }
    });
    // The queue must not stay rejected for later callers; the body already
    // swallows, so this is belt and braces.
    dismissalQueue = run.catch(() => undefined);
    return run;
}

/**
 * The notification to show right now, or null.
 *
 * Never rejects and never throws. Every failure mode — offline, 5xx, malformed
 * body, storage unavailable — resolves to stale cache or null, because the
 * caller is the sidebar bootstrap and a broken notification channel must cost
 * the user nothing.
 */
export async function getNotification(
    query: NotificationQuery,
): Promise<RemoteNotification | null> {
    const now = Date.now();
    try {
        const cache = await readCache();

        // Fresh cache: no network at all.
        if (cache.docs && now - cache.cachedAt < CACHE_TTL_MS) {
            return selectNotification(cache.docs, query, now, cache.dismissed);
        }

        // Backing off after a failure: serve whatever we have, stale included.
        // Better a slightly old message than hammering a down backend.
        if (now < cache.retryAfter) {
            return cache.docs ? selectNotification(cache.docs, query, now, cache.dismissed) : null;
        }

        const fresh = await fetchNotificationDocs();
        if (!fresh) {
            await writeBackoff(now);
            // Stale beats nothing: an outage during an incident is exactly when
            // the last-known message is most likely to still be the right one.
            return cache.docs ? selectNotification(cache.docs, query, now, cache.dismissed) : null;
        }

        // Re-read before pruning. `cache` was taken before a network call that
        // can run for seconds, and DISMISS_NOTIFICATION is handled in its own
        // unserialized async task — so the user may have closed the banner
        // while this request was in flight. Writing the stale snapshot back
        // would drop that dismissal and the banner would return.
        const latest = (await readCache()).dismissed;

        // Prune only when the response actually carried documents. An empty
        // collection is a legitimate "nothing to show", but it is also what a
        // half-broken backend returns, and clearing every dismissal on one such
        // reply would resurrect banners people had closed. Keeping a few dead
        // ids costs bytes; that costs trust.
        const dismissed = fresh.length ? pruneDismissals(latest, fresh, now) : latest;
        await writeCache(fresh, now, dismissed);
        return selectNotification(fresh, query, now, dismissed);
    } catch (err) {
        // Belt and braces: nothing above is expected to throw, but this
        // function sits in the sidebar's startup path and must not be the
        // reason it fails.
        console.debug('[Lingogram] notification lookup failed:', err);
        return null;
    }
}
