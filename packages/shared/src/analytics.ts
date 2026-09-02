// Anonymous usage analytics — the half that is safe to bundle anywhere.
//
// Split from analytics-bg.ts on purpose: THIS file must never read
// __GA4_API_SECRET__. It is exported from the package barrel, so it ends up in
// content-script bundles that anyone can read from a page's sources on
// youtube.com. analytics-bg.ts holds the secret and the transport, is imported
// only by the service worker, and is deliberately absent from the barrel.
//
// What lives here: the event vocabulary, the payload shape, the sanitiser, the
// platform label, the once-per-scope helper, and the content-side send (which
// is a chrome.runtime message, not a network call). Everything is either pure
// or a single chrome.runtime.sendMessage — which is what makes the whole file
// testable without a network stub.
//
// The privacy contract this file enforces mechanically (not by convention):
// no account identifier ever reaches the payload. See DENIED_PARAM_KEYS.

/**
 * Every event this codebase may send. Keeping the vocabulary in one union means
 * GA4's naming rules can be checked by a test that loops over
 * ALL_ANALYTICS_EVENTS, rather than trusting each call site.
 */
export type AnalyticsEvent =
    // Lifecycle
    | 'extension_installed'
    | 'extension_updated'
    // Activation funnel
    | 'onboarding_shown'
    | 'languages_configured'
    | 'subtitles_loaded'
    | 'dual_subs_shown'
    | 'no_subtitles'
    // Failure diagnostics (throttling / partial track loads)
    | 'subs_partial'
    | 'subs_rate_limited'
    | 'subs_recovered'
    // The extension showed no subtitles for a video whose native CC control
    // says captions exist. Deliberately NOT a param on no_subtitles: that event
    // fires for the perfectly healthy "this video has no captions" case too, and
    // this one only ever means our own failure.
    | 'subs_missed_with_cc'
    // The user downloaded a subtitle track as an SRT file from the sidebar.
    | 'subs_downloaded'
    // Value moment
    | 'word_save_attempt'
    | 'word_saved'
    // The hover strip / word screen asked the dictionary service. Carries only
    // shape (source, level, latency bucket) — the word itself is denied.
    | 'word_lookup'
    | 'signin_started'
    // Consent
    | 'analytics_opt_out'
    // Remote notification channel. Only failures are tracked: a success happens
    // for every user every cache interval and answers no question the failure
    // rate does not already answer against a known denominator.
    | 'notification_fetch_failed'
    // Retention milestones — sent by analytics-bg, never by product code.
    | 'retained_d2'
    | 'retained_d7'
    | 'retained_d14';

/**
 * Runtime mirror of the union. Exported so the allow-list in analytics-bg and
 * the naming-rule test share one source of truth: a name added to the type but
 * forgotten here would be rejected at the message boundary.
 */
export const ALL_ANALYTICS_EVENTS: readonly AnalyticsEvent[] = [
    'extension_installed',
    'extension_updated',
    'onboarding_shown',
    'languages_configured',
    'subtitles_loaded',
    'dual_subs_shown',
    'no_subtitles',
    'subs_partial',
    'subs_rate_limited',
    'subs_recovered',
    'subs_missed_with_cc',
    'subs_downloaded',
    'word_save_attempt',
    'word_saved',
    'word_lookup',
    'signin_started',
    'analytics_opt_out',
    'notification_fetch_failed',
    'retained_d2',
    'retained_d7',
    'retained_d14',
] as const;

/**
 * Events whose payload is expected to carry a `site` param. The background's
 * TRACK_EVENT handler derives a fallback `site` from the sender tab for these
 * and ONLY these: `languages_configured` and `analytics_opt_out` are sent from
 * both content scripts and the popup, so an unconditional fallback would give
 * them a `site` that appears and disappears depending on which surface sent
 * the event.
 */
export const SITE_BEARING_EVENTS: ReadonlySet<AnalyticsEvent> = new Set<AnalyticsEvent>([
    'onboarding_shown',
    'subtitles_loaded',
    'dual_subs_shown',
    'no_subtitles',
    'subs_partial',
    'subs_rate_limited',
    'subs_recovered',
    'subs_missed_with_cc',
    'subs_downloaded',
    'word_save_attempt',
    'word_saved',
    'word_lookup',
]);

export type AnalyticsParamValue = string | number | boolean;
export interface AnalyticsParams {
    [k: string]: AnalyticsParamValue | undefined;
}

/** The message content scripts and the popup post to the service worker. */
export const TRACK_EVENT_ACTION = 'TRACK_EVENT' as const;

export interface TrackEventMessage {
    action: typeof TRACK_EVENT_ACTION;
    event: AnalyticsEvent;
    params: AnalyticsParams;
}

// ---------------------------------------------------------------------------
// Platform label
// ---------------------------------------------------------------------------

/**
 * Coarse platform label. Deliberately NOT location.hostname:
 *
 *  - `ext_source` can't answer "how much YouTube vs Netflix?" — Netflix runs
 *    inside the youtube extension, so both report 'youtube-extension'.
 *  - a raw hostname would split one platform across many values
 *    (www./m.youtube.com; ~250 rezka mirrors in the manifest) and burn GA4's
 *    per-parameter cardinality budget for no analytical gain.
 *  - it is also the privacy-safe choice: 'rezka' says which product surface
 *    was used, a full hostname edges toward browsing history.
 */
export type Platform = 'youtube' | 'netflix' | 'rezka' | 'web' | 'other';

/**
 * Maps a hostname to its platform. Pure — no chrome, no globals — so the
 * mirror list is verifiable by a table test.
 *
 * Matching is suffix-based on the registrable-ish tail so subdomains
 * (m.youtube.com, www.netflix.com, hdrezka.website) fold into one label
 * without needing the manifest's full 250-mirror list here.
 */
export function platformOf(hostname: string): Platform {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host) return 'other';
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
        return 'youtube';
    }
    if (host === 'netflix.com' || host.endsWith('.netflix.com')) return 'netflix';
    // Rezka ships ~250 mirror domains that differ only by TLD, plus the
    // voidboost CDN that serves its subtitles. Match on the label rather than
    // enumerating: a new mirror TLD appears without a code change.
    if (/(^|\.)(hd)?rezka[^.]*\./.test(host + '.') || /(^|\.)voidboost\./.test(host + '.')) {
        return 'rezka';
    }
    return 'other';
}

// ---------------------------------------------------------------------------
// Parameter sanitising
// ---------------------------------------------------------------------------

// GA4 limits: 25 params/event, 40-char names, 100-char values. We reserve a
// few slots for the dimensions buildPayload always appends.
const MAX_PARAMS = 18;
const MAX_PARAM_NAME = 40;
const MAX_PARAM_VALUE = 100;

/**
 * Parameter names that must never reach the payload.
 *
 * This is a mechanical backstop for the product's central privacy promise —
 * that analytics cannot be joined to a person's account. Relying on call-site
 * discipline would mean one careless spread (`...request`) silently breaks the
 * privacy policy; a deny-list breaks the test instead.
 */
export const DENIED_PARAM_KEYS: readonly string[] = [
    'uid',
    'user_id',
    'userid',
    'email',
    'id_token',
    'refresh_token',
    // Payload of the saved word and its subtitle context: user content, never
    // telemetry.
    'term',
    'context',
    'text',
    // Anything that could carry the video identity.
    'url',
    'video_id',
    'video_ref',
    'title',
] as const;

export function sanitizeParams(params: AnalyticsParams = {}): Record<string, AnalyticsParamValue> {
    const out: Record<string, AnalyticsParamValue> = {};
    let n = 0;
    for (const [rawKey, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        // The declared type is string|number|boolean, but these params arrive
        // over sendMessage from content scripts, where the type is a claim
        // rather than a guarantee. An allow-list keeps an object or array —
        // exactly what a careless `...request` spread produces — from riding
        // into the payload as "[object Object]" or as a nested user-content
        // structure the deny-list never gets to inspect.
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            continue;
        }
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        // Matched on the name as written. Every denied name is far shorter than
        // MAX_PARAM_NAME, so this happens to agree with matching the truncated
        // name on every possible input — but only by arithmetic that a longer
        // entry in the list would quietly break. Checking the raw name keeps
        // the backstop independent of what is in the list.
        if (DENIED_PARAM_KEYS.includes(rawKey.toLowerCase())) continue;
        if (n >= MAX_PARAMS) break;
        const key = rawKey.slice(0, MAX_PARAM_NAME);
        // Two names differing only past the 40-char limit collapse onto one
        // key: the later value would overwrite the earlier while both consumed
        // the MAX_PARAMS budget, so the payload silently lost a parameter it
        // had already paid for. First writer wins, which matches the drop-on-
        // budget behaviour above.
        if (key in out) continue;
        out[key] = typeof value === 'string' ? value.slice(0, MAX_PARAM_VALUE) : value;
        n++;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface GA4Payload {
    client_id: string;
    non_personalized_ads: true;
    events: Array<{ name: AnalyticsEvent; params: Record<string, AnalyticsParamValue> }>;
}

export interface PayloadContext {
    clientId: string;
    sessionId: string;
    /** Whole days since install; omitted for installs that predate analytics. */
    daysSinceInstall?: number;
    extSource: string;
    extVersion: string;
    extEnv: string;
    /**
     * Which backend the events were produced against — 'prod' or 'preprod'.
     *
     * Distinct from `extEnv`, which is the BUILD type. A dev build can be
     * pointed at either backend at runtime (see auth/devEnvSwitch), so without
     * this a session spent testing against preprod is indistinguishable from
     * one against real production data in the same dev property.
     *
     * Omitted by prod builds, where the question cannot arise: they contain no
     * switch, so ext_env='prod' already answers it.
     */
    backend?: string;
}

/**
 * Builds the Measurement Protocol body. Pure, so the two invisible-failure
 * traps below are covered by unit tests instead of by squinting at DebugView:
 *
 *  - `session_id` and `engagement_time_msec` are REQUIRED. Without them GA4
 *    accepts the hit (HTTP 204) and the event never appears in any report —
 *    the least debuggable failure mode in this whole subsystem.
 *  - `client_id` belongs at the top level, not in params.
 *
 * `user_id` is deliberately absent and must stay that way: sending it would
 * join anonymous telemetry to the Firebase account and invalidate the privacy
 * policy's central claim.
 */
export function buildPayload(
    event: AnalyticsEvent,
    params: AnalyticsParams,
    ctx: PayloadContext,
): GA4Payload {
    const merged: Record<string, AnalyticsParamValue> = {
        ...sanitizeParams(params),
        session_id: ctx.sessionId,
        // GA4 treats a session with no engagement time as zero-engagement and
        // filters it out of most reports.
        engagement_time_msec: 1,
        ext_source: ctx.extSource,
        ext_version: ctx.extVersion,
        ext_env: ctx.extEnv,
    };
    if (typeof ctx.daysSinceInstall === 'number') {
        merged.days_since_install = ctx.daysSinceInstall;
    }
    if (ctx.backend) {
        merged.backend = ctx.backend;
    }
    return {
        client_id: ctx.clientId,
        // We run no ads; stating it explicitly keeps these hits out of any
        // advertising audience Google might otherwise build from them.
        non_personalized_ads: true,
        events: [{ name: event, params: merged }],
    };
}

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

// Must match packages/embed/src/chrome-shim.ts, which sets this as its fake
// chrome.runtime.id. Duplicated as a literal on purpose: packages/shared must
// not import from packages/embed (embed depends on shared — the import would
// create a cycle).
export const EMBED_RUNTIME_ID = 'lingogram-embed';

/**
 * True when this code is NOT running inside a real extension.
 *
 * The marketing site runs the real content modules against a faked `chrome`
 * (packages/embed/src/chrome-shim.ts). That shim no-ops `storage.local.set`,
 * so the analytics opt-out toggle physically cannot work there — meaning an
 * unguarded module would beacon every site visitor to GA4 with no way to
 * decline. Three independent checks, all failing closed.
 */
export function isEmbed(): boolean {
    try {
        if (typeof chrome === 'undefined' || !chrome.runtime) return true;
        if (chrome.runtime.id === EMBED_RUNTIME_ID) return true;
        // The shim implements id/sendMessage/onMessage/getURL/storage and
        // nothing else; a real extension always has getManifest.
        if (typeof chrome.runtime.getManifest !== 'function') return true;
        return false;
    } catch {
        return true;
    }
}

// ---------------------------------------------------------------------------
// Content-side send
// ---------------------------------------------------------------------------

/**
 * Hands an event to the service worker. Content scripts and the popup use this
 * instead of calling GA4 directly, for three reasons: the API secret stays out
 * of page-readable bundles, the worker isn't subject to the page's CSP, and the
 * opt-out gate stays in exactly one place (analytics-bg's track()).
 *
 * Fire-and-forget and never throws — a telemetry failure must not surface in,
 * or interrupt, anything the user is doing.
 */
export function trackVia(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
    try {
        if (isEmbed()) return;
        // Orphaned content script after an extension reload: sendMessage would
        // throw 'Extension context invalidated'.
        if (!chrome.runtime?.id) return;
        const message: TrackEventMessage = { action: TRACK_EVENT_ACTION, event, params };
        chrome.runtime.sendMessage(message, () => {
            // Reading lastError suppresses Chrome's "unchecked runtime.lastError"
            // console noise when the worker is asleep or the receiver is gone.
            void chrome.runtime.lastError;
        });
    } catch {
        // Analytics must never break a user flow.
    }
}

// ---------------------------------------------------------------------------
// Once-per-scope
// ---------------------------------------------------------------------------

/**
 * Fires a callback at most once per key until reset().
 *
 * Lives here rather than as a scatter of booleans on BaseVttApp because the
 * de-duplication rule is analytics knowledge, not player knowledge. The seams
 * that need it (a track landing, a failure being noted) are called many times
 * per video — noteTrackFailure() runs per failed track, evaluateSubtitleOutcome()
 * per evaluation cycle — so an unguarded send turns one throttling incident
 * into dozens of hits.
 *
 * Reset discipline (this is the subtle part): call reset() from
 * resetNoSubsRetries(), NOT from resetForNewVideo(). The latter also runs
 * inside reprocessCurrentVideo() — the manual "Search again" — so resetting
 * there would re-arm every one-shot on each retry and produce duplicate events
 * for the same video. The codebase already draws that exact line for
 * cooldownUntil.
 */
export class OncePerScope {
    private fired = new Set<string>();

    /** Runs `send` the first time this key is seen in the current scope. */
    fire(key: string, send: () => void): void {
        if (this.fired.has(key)) return;
        // Mark before sending: a throwing callback must not leave the key
        // un-fired, or the next call would retry it and duplicate the event.
        this.fired.add(key);
        try {
            send();
        } catch {
            // Same contract as trackVia: never propagate into product code.
        }
    }

    /** True if this key has already fired in the current scope. */
    hasFired(key: string): boolean {
        return this.fired.has(key);
    }

    /** Re-arms every key. Call on a genuine scope change (new video). */
    reset(): void {
        this.fired.clear();
    }
}
