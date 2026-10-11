// Define Vite build-time globals so background/auth modules can be imported in tests.
(global as any).__EXT_ENV__ = 'dev';
(global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
(global as any).__FIREBASE_API_KEY__ = 'demo';
(global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
(global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
(global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
(global as any).__FRONTEND_BASE_URL__ = 'http://localhost:5173';
(global as any).__EXT_SOURCE__ = 'rezka-extension';
// No other target in tests: the dev backend switch stays inert, which is also
// what a checkout with no credentials gets.
(global as any).__EXT_DEV_TARGETS__ = '';
(global as any).__EXT_HOME_TARGET_NAME__ = '';
(global as any).__EXT_DEV_DEFAULT_TARGET__ = '';
// Lookup API. A non-empty value keeps the LOOKUP_WORD handler's "not
// configured" early-return from short-circuiting the tests that mean to
// exercise the real path; tests wanting the off state override config locally.
(global as any).__EXT_API_BASE_URL__ = 'https://api.test';
(global as any).__LIMIT_MAX_WORDS_PER_DAY__ = 500;
(global as any).__LIMIT_MIN_INTERVAL_MS__ = 1000;
(global as any).__LIMIT_MAX_TERM_BYTES__ = 256;
(global as any).__LIMIT_MAX_SOURCE_URL_BYTES__ = 2048;
(global as any).__LIMIT_MAX_CONTEXT_BYTES__ = 2048;
(global as any).__LIMIT_MAX_TITLE_BYTES__ = 512;
(global as any).__LIMIT_MAX_FEEDBACK_TEXT_BYTES__ = 2000;
(global as any).__LIMIT_SUBTITLE__ = {
    SUBTITLE_LANGS: [
        'en', 'ru', 'uk', 'be', 'kk', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'sk', 'tr',
        'ar', 'he', 'fa', 'hi', 'ja', 'ko', 'zh', 'vi', 'th', 'id', 'nl', 'sv', 'no', 'da', 'fi', 'el', 'hu', 'ro',
        'bg', 'sr', 'hr', 'lt', 'lv', 'et', 'ka', 'hy', 'az', 'uz',
    ],
    SUBTITLE_SITES: ['rezka', 'netflix', 'youtube'],
    SUBTITLE_TTL_DAYS: 14,
    SUBTITLE_MAX_CUES: 4000,
    SUBTITLE_MAX_DURATION_MS: 14400000,
    SUBTITLE_MAX_CUE_TEXT: 500,
    SUBTITLE_MIN_CUE_MS: 300,
    SUBTITLE_MAX_CHARS_PER_SEC: 25,
    SUBTITLE_MAX_CUE_CHARS_PER_SEC: 50,
    SUBTITLE_WRITES_PER_DAY: 30,
    SUBTITLE_MIN_INTERVAL_S: 20,
};
// GA4 build constants. A non-empty secret here keeps the analytics module's
// "unconfigured build" early-return from silently short-circuiting every test
// that means to exercise the real path; tests that want the no-op path
// override these locally.
(global as any).__GA4_MEASUREMENT_ID__ = 'G-TEST';
(global as any).__GA4_API_SECRET__ = 'test-secret';
(global as any).__GA4_ENDPOINT__ = 'https://ga4.test';

// jsdom doesn't expose TextEncoder/Decoder by default; pull from Node util.
if (typeof (global as any).TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
    (global as any).TextDecoder = TextDecoder;
}
