// Define Vite build-time globals so background/auth modules can be imported in tests.
(global as any).__EXT_ENV__ = 'dev';
(global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
(global as any).__FIREBASE_API_KEY__ = 'demo';
(global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
(global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
(global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
(global as any).__FRONTEND_BASE_URL__ = 'http://localhost:5173';
(global as any).__EXT_SOURCE__ = 'rezka-extension';
// No second target in tests: the dev backend switch stays inert, which is also
// what a checkout with no credentials gets.
(global as any).__EXT_ALT_PROJECT_ID__ = '';
(global as any).__EXT_ALT_API_KEY__ = '';
(global as any).__EXT_ALT_FRONTEND_BASE_URL__ = '';
// Lookup API. A non-empty value keeps the LOOKUP_WORD handler's "not
// configured" early-return from short-circuiting the tests that mean to
// exercise the real path; tests wanting the off state override config locally.
(global as any).__EXT_API_BASE_URL__ = 'https://api.test';
(global as any).__EXT_ALT_API_BASE_URL__ = '';
(global as any).__LIMIT_MAX_WORDS_PER_DAY__ = 500;
(global as any).__LIMIT_MIN_INTERVAL_MS__ = 1000;
(global as any).__LIMIT_MAX_TERM_BYTES__ = 256;
(global as any).__LIMIT_MAX_SOURCE_URL_BYTES__ = 2048;
(global as any).__LIMIT_MAX_CONTEXT_BYTES__ = 2048;
(global as any).__LIMIT_MAX_TITLE_BYTES__ = 512;
(global as any).__LIMIT_MAX_FEEDBACK_TEXT_BYTES__ = 2000;
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
