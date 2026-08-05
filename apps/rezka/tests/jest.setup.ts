// Define Vite build-time globals so background/auth modules can be imported in tests.
(global as any).__EXT_ENV__ = 'dev';
(global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
(global as any).__FIREBASE_API_KEY__ = 'demo';
(global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
(global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
(global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
(global as any).__FRONTEND_BASE_URL__ = 'http://localhost:5173';
(global as any).__EXT_SOURCE__ = 'rezka-extension';
(global as any).__LIMIT_MAX_WORDS_PER_DAY__ = 500;
(global as any).__LIMIT_MIN_INTERVAL_MS__ = 1000;
(global as any).__LIMIT_MAX_TERM_BYTES__ = 256;
(global as any).__LIMIT_MAX_SOURCE_URL_BYTES__ = 2048;
(global as any).__LIMIT_MAX_CONTEXT_BYTES__ = 2048;
(global as any).__LIMIT_MAX_TITLE_BYTES__ = 512;
(global as any).__LIMIT_MAX_FEEDBACK_TEXT_BYTES__ = 2000;

// jsdom doesn't expose TextEncoder/Decoder by default; pull from Node util.
if (typeof (global as any).TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
    (global as any).TextDecoder = TextDecoder;
}
