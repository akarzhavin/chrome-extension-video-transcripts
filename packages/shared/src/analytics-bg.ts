// Anonymous usage analytics — service-worker half.
//
// NOT exported from the package barrel (packages/shared/src/index.ts) and it
// must stay that way: this file reads __GA4_API_SECRET__, and the barrel is
// imported by content scripts whose bundles are readable from any page. Import
// it by relative path, and only from a service worker.
//
// Everything user-visible about consent converges on track(): it is the only
// place that decides whether a hit leaves the machine. Callers — including the
// TRACK_EVENT message handler — never re-check the preference, so there is
// exactly one gate to audit and no call site that can bypass it.

import { OPTED_OUT } from './onboarding';
import { PREFS_KEY } from './prefs';
import { ANALYTICS_KEYS, ANALYTICS_SESSION_KEYS } from './auth/storage';
import {
    ALL_ANALYTICS_EVENTS,
    SITE_BEARING_EVENTS,
    buildPayload,
    isEmbed,
    platformOf,
    type AnalyticsEvent,
    type AnalyticsParams,
} from './analytics';

const DAY_MS = 86_400_000;
// GA4's own session definition, so our session_id rolls over when its would.
const SESSION_TTL_MS = 30 * 60 * 1000;

/** days_since_install → milestone event. Index is the day the event fires on. */
const RETENTION_MILESTONES: ReadonlyArray<{
    day: number;
    event: AnalyticsEvent;
    key: string;
}> = [
    { day: 1, event: 'retained_d2', key: ANALYTICS_KEYS.d2Sent },
    { day: 6, event: 'retained_d7', key: ANALYTICS_KEYS.d7Sent },
    { day: 13, event: 'retained_d14', key: ANALYTICS_KEYS.d14Sent },
];

// Cached per service-worker wake. MV3 recycles the worker after ~30s idle, so
// this is a per-wake memo, not a long-lived cache — the storage read it saves
// is sub-millisecond but happens on every event.
let cachedClientId: string | null = null;
// In-flight mint, shared by concurrent getClientId callers. See the comment there.
let clientIdInFlight: Promise<string | null> | null = null;

/** Test seam: clears module state between cases. */
export function _resetAnalyticsCacheForTests(): void {
    cachedClientId = null;
    clientIdInFlight = null;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The GA4 client_id: a random UUID minted on first use and kept in
 * chrome.storage.local.
 *
 * Deliberately NOT derived from the Firebase uid, and the uid is never sent
 * alongside it. That is what makes "we cannot connect your analytics to your
 * account" a structural fact rather than a policy promise.
 *
 * Persistent rather than per-session because install and first-save almost
 * always fall in different browser sessions: a session-scoped id would leave
 * only the tail of the funnel visible and make retention impossible.
 */
export async function getClientId(): Promise<string | null> {
    if (cachedClientId) return cachedClientId;
    // Concurrent callers share one attempt. The read-then-mint below is not
    // atomic, so two overlapping calls would both see empty storage, both mint,
    // and the second write would silently replace the first — leaving whoever
    // read earlier holding an id the extension no longer has. That is not
    // theoretical: install fires markInstalled and the onboarding resolver in
    // the same tick, and a real browser run produced a welcome URL whose cid
    // did not match stored state.
    if (!clientIdInFlight) {
        clientIdInFlight = mintOrReadClientId().finally(() => {
            clientIdInFlight = null;
        });
    }
    return clientIdInFlight;
}

async function mintOrReadClientId(): Promise<string | null> {
    let stored: unknown;
    try {
        const v = await chrome.storage.local.get(ANALYTICS_KEYS.clientId);
        stored = v[ANALYTICS_KEYS.clientId];
    } catch {
        // Fails CLOSED, unlike the write below. A read that throws cannot tell
        // "no id yet" apart from "the id is there but unreachable", and minting
        // one on that guess is the expensive answer: MV3 recycles the worker
        // after ~30s idle, so a persistently unreadable storage would mint a
        // new UUID every wake and report one machine as an endless stream of
        // new users — every retention cohort poisoned, in the direction that
        // flatters. Dropping the event loses one hit instead. Same reasoning as
        // daysSinceInstall's refusal to fake a date.
        return null;
    }
    if (typeof stored === 'string' && stored) {
        cachedClientId = stored;
        return stored;
    }
    const fresh = crypto.randomUUID();
    cachedClientId = fresh;
    try {
        await chrome.storage.local.set({ [ANALYTICS_KEYS.clientId]: fresh });
    } catch {
        // Unpersisted: this wake still reports under `fresh`. Safe where the
        // read is not, because storage answered — there is genuinely no id yet,
        // so this is a first mint rather than a possible duplicate.
    }
    return fresh;
}

/**
 * Rolling 30-minute session id in chrome.storage.session — which survives
 * service-worker recycling but clears on browser restart, matching what a
 * "session" means in GA4.
 */
export async function getSessionId(now: number = Date.now()): Promise<string> {
    try {
        const v = await chrome.storage.session.get([
            ANALYTICS_SESSION_KEYS.sessionId,
            ANALYTICS_SESSION_KEYS.sessionAt,
        ]);
        const id = v[ANALYTICS_SESSION_KEYS.sessionId];
        const at = Number(v[ANALYTICS_SESSION_KEYS.sessionAt] ?? 0);
        if (typeof id === 'string' && id && now - at < SESSION_TTL_MS) {
            // Touch so an active session keeps rolling forward.
            void chrome.storage.session.set({ [ANALYTICS_SESSION_KEYS.sessionAt]: now });
            return id;
        }
    } catch {
        // Session storage unavailable — fall through to a fresh id.
    }
    // Random rather than String(now), which is not actually unique: when
    // session storage is unavailable every hit in the same millisecond shares
    // an id, and a clock moved backwards (NTP correction, manual change) hands
    // out an id belonging to a session GA4 has already closed. A UUID cannot
    // collide either way, and nothing reads a timestamp back out of this value.
    const fresh = crypto.randomUUID();
    try {
        await chrome.storage.session.set({
            [ANALYTICS_SESSION_KEYS.sessionId]: fresh,
            [ANALYTICS_SESSION_KEYS.sessionAt]: now,
        });
    } catch {
        // Non-fatal: the id is still valid for this hit.
    }
    return fresh;
}

/**
 * Whole days since install, or undefined when the install predates analytics.
 *
 * Undefined is meaningful and must not be faked: substituting the update date
 * would invent a cohort of users who "installed today", which is exactly the
 * kind of number that quietly poisons a retention report. Those installs simply
 * sit outside retention until they're replaced by fresh ones.
 */
export async function daysSinceInstall(now: number = Date.now()): Promise<number | undefined> {
    try {
        const v = await chrome.storage.local.get(ANALYTICS_KEYS.installedAt);
        const at = Number(v[ANALYTICS_KEYS.installedAt] ?? 0);
        if (!at) return undefined;
        const days = Math.floor((now - at) / DAY_MS);
        return days >= 0 ? days : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Stamps the install date and mints the client id. Called from the onInstalled
 * INSTALL branch only. The date is never overwritten: an update must not
 * restart the retention clock.
 *
 * The id is minted here rather than left to the first hit that needs it, and
 * unconditionally — the consent gate is NOT consulted. Minting is not
 * collecting: getClientId only writes a random UUID to this extension's own
 * storage.local, and `track` still refuses to send anything while analytics is
 * off, so an opted-out install produces an id that is never read and never
 * leaves the machine. What this buys is that the id exists from the install
 * event onward, so it cannot be missed by a first hit that dies with the
 * worker, fails on a cold network, or arrives while the preference is still
 * being written — and a visitor who turns analytics back on later keeps the
 * same identity instead of arriving as a brand-new user.
 */
export async function markInstalled(now: number = Date.now()): Promise<void> {
    // Awaited, not fire-and-forget: the worker can be torn down moments after
    // onInstalled returns, and an unawaited mint would race that teardown —
    // exactly the case this function exists to close. getClientId swallows its
    // own storage errors and is independent of the date stamp below, so a
    // failure on either side cannot cost us the other.
    await getClientId();
    try {
        const v = await chrome.storage.local.get(ANALYTICS_KEYS.installedAt);
        if (v[ANALYTICS_KEYS.installedAt]) return;
        // UTC midnight, so days_since_install counts calendar days rather than
        // "was it before or after the hour I happened to install".
        const midnight = Math.floor(now / DAY_MS) * DAY_MS;
        await chrome.storage.local.set({ [ANALYTICS_KEYS.installedAt]: midnight });
    } catch {
        // Without this the install just never reports retention — acceptable.
    }
}

// ---------------------------------------------------------------------------
// Consent gate
// ---------------------------------------------------------------------------

/**
 * Reads the opt-out preference straight from the prefs blob rather than via
 * loadPrefs(), because the two want opposite behaviour on failure: loadPrefs
 * returns defaults (analytics ON) so the UI still renders, while consent must
 * fail CLOSED — a storage error is not permission to collect.
 *
 * Absent field → true. That is the documented "on by default, no migration"
 * contract for installs whose prefs blob predates this feature.
 */
export async function isAnalyticsEnabled(): Promise<boolean> {
    try {
        const v = (await chrome.storage.local.get(PREFS_KEY)) as Record<string, unknown>;
        const raw = v[PREFS_KEY];
        if (typeof raw !== 'object' || raw === null) return true;
        const flag = (raw as Record<string, unknown>).analyticsEnabled;
        return flag === undefined ? true : flag === true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function collectUrl(): string {
    // Dev posts to the validating endpoint, which returns validationMessages
    // instead of a silent 204 — the only practical way to catch a malformed
    // payload before it becomes "the report is mysteriously empty".
    const path = __EXT_ENV__ === 'dev' ? '/debug/mp/collect' : '/mp/collect';
    return (
        `${__GA4_ENDPOINT__}${path}` +
        `?measurement_id=${encodeURIComponent(__GA4_MEASUREMENT_ID__)}` +
        `&api_secret=${encodeURIComponent(__GA4_API_SECRET__)}`
    );
}

function manifestVersion(): string {
    try {
        return chrome.runtime.getManifest?.().version ?? '';
    } catch {
        return '';
    }
}

async function post(body: string): Promise<void> {
    // keepalive hands the request to the network stack so it survives the
    // service worker being torn down mid-flight — the MV3 equivalent of
    // sendBeacon. No Content-Type header: gtag doesn't send one either, and
    // adding application/json triggers a CORS preflight on some Chrome builds.
    const res = await fetch(collectUrl(), { method: 'POST', body, keepalive: true });
    if (__EXT_ENV__ === 'dev') {
        const json = (await res.json().catch(() => null)) as
            | { validationMessages?: unknown[] }
            | null;
        const messages = json?.validationMessages;
        if (Array.isArray(messages) && messages.length > 0) {
            console.warn('[Lingogram GA4] payload rejected:', messages);
        }
    }
    // Prod deliberately does not read the body: it would keep the worker alive
    // to parse a response nobody looks at.
}

/**
 * Reports which backend is live, for builds that can switch between them.
 *
 * Injected rather than imported: auth/devEnvSwitch pulls in `config` and the
 * whole auth layer, and this module deliberately depends on neither. The
 * background script wires it up in one line; everything else leaves it unset
 * and simply omits the parameter.
 */
let backendResolver: (() => string | undefined) | null = null;

export function setBackendResolver(fn: (() => string | undefined) | null): void {
    backendResolver = fn;
}

function currentBackend(): string | undefined {
    // A throwing resolver must not cost us the event it was decorating.
    try {
        return backendResolver?.() || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Sends one event. Fire-and-forget: never throws, never rejects.
 *
 * This is the only function that talks to GA4, and the only one that consults
 * the opt-out preference. Both properties are load-bearing — see the file
 * header.
 */
export async function track(event: AnalyticsEvent, params: AnalyticsParams = {}): Promise<void> {
    try {
        // A build without credentials is a no-op, not a stream of broken hits.
        if (!__GA4_MEASUREMENT_ID__ || !__GA4_API_SECRET__) return;
        if (isEmbed()) return;
        // analytics_opt_out is the one event the gate must not swallow: it
        // reports that the gate is being closed, so by the time anyone can act
        // on it the preference already says no.
        //
        // Call sites send it before writing the preference, which is enough
        // when the worker is already awake. It is not enough from a content
        // script: sendMessage has to COLD-START the worker, and that takes
        // tens of milliseconds while the write lands ~0.1ms after the send.
        // The worker then reads a preference that is already false and drops
        // the event. Measured, not assumed — the sidebar toggle produced zero
        // hits until this exemption existed.
        //
        // Exempting one event by name is narrower than it looks: it carries no
        // parameters, it is sent once, and every other path still goes through
        // the gate untouched.
        if (event !== 'analytics_opt_out' && !(await isAnalyticsEnabled())) return;

        const now = Date.now();
        const [clientId, sessionId, days] = await Promise.all([
            getClientId(),
            getSessionId(now),
            daysSinceInstall(now),
        ]);
        // No readable identity, no hit. Reporting under an invented id would
        // add a phantom user to every count it touches; losing the event only
        // undercounts a machine whose storage is already broken.
        if (clientId === null) return;
        const ctx = {
            clientId,
            sessionId,
            daysSinceInstall: days,
            extSource: __EXT_SOURCE__,
            extVersion: manifestVersion(),
            extEnv: __EXT_ENV__,
            backend: currentBackend(),
        };

        await post(JSON.stringify(buildPayload(event, params, ctx)));

        // Retention milestones ride along with whatever event woke us, so
        // product code never has to know they exist. Sent after the primary
        // hit so a milestone failure can't cost us the real event.
        await sendDueMilestones(days, ctx);
    } catch {
        // Same contract as addNoSubsReport: telemetry never surfaces an error
        // and never affects a user flow.
    }
}

/**
 * Emits any retention milestone whose day has arrived and which hasn't fired.
 *
 * Missed days are NOT backfilled: a user first seen on day 7 sends retained_d7
 * only. Firing retained_d2 retroactively would fill the D2 cohort with people
 * who were never observed on D2 and make the number unreadable.
 */
async function sendDueMilestones(
    days: number | undefined,
    ctx: Parameters<typeof buildPayload>[2],
): Promise<void> {
    if (typeof days !== 'number') return;
    const due = RETENTION_MILESTONES.find((m) => m.day === days);
    if (!due) return;
    try {
        const v = await chrome.storage.local.get(due.key);
        if (v[due.key] === true) return;
        await chrome.storage.local.set({ [due.key]: true });
        await post(JSON.stringify(buildPayload(due.event, {}, ctx)));
    } catch {
        // A missed milestone costs one data point, nothing else.
    }
}

// ---------------------------------------------------------------------------
// Message boundary
// ---------------------------------------------------------------------------

const KNOWN_EVENTS: ReadonlySet<string> = new Set<string>(ALL_ANALYTICS_EVENTS);

/**
 * Handles TRACK_EVENT from a content script or the popup.
 *
 * The event name is checked against an allow-list rather than passed through: a
 * compromised or buggy content script must not be able to write arbitrary event
 * names into the property, which would be both unfixable (GA4 keeps them) and
 * quota-consuming.
 *
 * No consent check here — track() owns that. Duplicating it would create a
 * second place to keep in sync.
 */
export async function handleTrackMessage(
    request: Record<string, unknown>,
    sender?: chrome.runtime.MessageSender,
): Promise<{ ok: boolean }> {
    const event = typeof request.event === 'string' ? request.event : '';
    if (!KNOWN_EVENTS.has(event)) return { ok: false };
    let params =
        typeof request.params === 'object' && request.params !== null
            ? (request.params as AnalyticsParams)
            : {};
    // Site fallback, but only for events whose shape includes `site` — see
    // SITE_BEARING_EVENTS. An explicit non-empty site always wins; a popup
    // sender has no tab and is left alone.
    if (SITE_BEARING_EVENTS.has(event as AnalyticsEvent)) {
        const site = params.site;
        if ((typeof site !== 'string' || site === '') && sender?.tab?.url) {
            try {
                params = { ...params, site: platformOf(new URL(sender.tab.url).hostname) };
            } catch {
                // Unparseable sender URL — send the params as they came.
            }
        }
    }
    await track(event as AnalyticsEvent, params);
    return { ok: true };
}

/**
 * The `cid` resolver every background script hands to installOnboarding.
 *
 * Lives here rather than in each extension because the rule it encodes is not
 * a per-edition choice: an install whose owner switched analytics off must
 * hand the onboarding pages a placeholder, never its real id. Copied into
 * three background scripts that rule would eventually be copied wrong, and the
 * failure is silent — the URL still works, it just quietly carries an identity
 * it had no permission to carry. A new edition gets the correct behaviour by
 * passing this function, and nothing else.
 *
 * It cannot live in onboarding.ts: that module is reachable from content
 * bundles and importing this file there would risk pulling the GA4 api_secret
 * into a page-readable script. Composition happens in the background entry
 * point, which is the only place both halves are legal.
 */
export async function onboardingClientId(): Promise<string> {
    try {
        if (!(await isAnalyticsEnabled())) return OPTED_OUT;
        return (await getClientId()) ?? OPTED_OUT;
    } catch {
        // Fails to the placeholder, not to a real id: an unreadable preference
        // is not permission. Same direction as the consent gate above.
        return OPTED_OUT;
    }
}
