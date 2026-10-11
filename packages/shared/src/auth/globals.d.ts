declare const __EXT_ENV__: 'dev' | 'prod';
declare const __FIREBASE_PROJECT_ID__: string;
declare const __FIREBASE_API_KEY__: string;
declare const __IDENTITY_TOOLKIT_URL__: string;
declare const __SECURE_TOKEN_URL__: string;
declare const __FIRESTORE_URL__: string;
declare const __FRONTEND_BASE_URL__: string;
declare const __EXT_SOURCE__: string;
// The dev-only backend switch's ring of targets: a JSON array of EnvTarget
// rows, supplied at build time from EXT_DEV_TARGETS. Empty string when the
// build was given none; never stored in the repo.
declare const __EXT_DEV_TARGETS__: string;
// What this build calls its OWN target, for the badge. Empty = derive it from
// the project id.
declare const __EXT_HOME_TARGET_NAME__: string;
/** The target a fresh dev install starts on; '' = the build's own. */
declare const __EXT_DEV_DEFAULT_TARGET__: string;
// Our own API (edge gateway) for POST /dictionary/lookup. Empty = feature off.
// Named __EXT_*__ so assert-shippable's unsubstituted-define rule covers it.
declare const __EXT_API_BASE_URL__: string;
declare const __LIMIT_MAX_WORDS_PER_DAY__: number;
/** Subtitle limits shared with the backend, from lingogram-limits.json. */
interface SubtitleLimits {
    SUBTITLE_LANGS: string[];
    SUBTITLE_SITES: string[];
    SUBTITLE_TTL_DAYS: number;
    SUBTITLE_MAX_CUES: number;
    SUBTITLE_MAX_DURATION_MS: number;
    SUBTITLE_MAX_CUE_TEXT: number;
    SUBTITLE_MIN_CUE_MS: number;
    SUBTITLE_MAX_CHARS_PER_SEC: number;
    SUBTITLE_MAX_CUE_CHARS_PER_SEC: number;
    SUBTITLE_WRITES_PER_DAY: number;
    SUBTITLE_MIN_INTERVAL_S: number;
}
declare const __LIMIT_SUBTITLE__: SubtitleLimits;
declare const __LIMIT_MIN_INTERVAL_MS__: number;
declare const __LIMIT_MAX_TERM_BYTES__: number;
declare const __LIMIT_MAX_SOURCE_URL_BYTES__: number;
declare const __LIMIT_MAX_CONTEXT_BYTES__: number;
declare const __LIMIT_MAX_TITLE_BYTES__: number;
declare const __LIMIT_MAX_FEEDBACK_TEXT_BYTES__: number;
// GA4 Measurement Protocol (see apps/*/vite.config.ts). Empty in builds that
// weren't given credentials, which makes analytics a no-op.
declare const __GA4_MEASUREMENT_ID__: string;
declare const __GA4_API_SECRET__: string;
declare const __GA4_ENDPOINT__: string;
