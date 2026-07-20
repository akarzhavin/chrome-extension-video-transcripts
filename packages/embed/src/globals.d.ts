// Build-time constants injected by vite (see vite.config.ts `define`). The
// shared package declares __EXT_ENV__ in its own ambient file, but that file
// isn't part of this program, so every constant the imported modules read is
// declared here for type-checking.
declare const __EXT_ENV__: 'dev' | 'prod';
declare const __FIREBASE_PROJECT_ID__: string;
declare const __FIREBASE_API_KEY__: string;
declare const __IDENTITY_TOOLKIT_URL__: string;
declare const __SECURE_TOKEN_URL__: string;
declare const __FIRESTORE_URL__: string;
declare const __FRONTEND_BASE_URL__: string;
declare const __EXT_SOURCE__: string;
declare const __LIMIT_MAX_WORDS_PER_DAY__: number;
declare const __LIMIT_MAX_TERM_BYTES__: number;
declare const __LIMIT_MAX_CONTEXT_BYTES__: number;
