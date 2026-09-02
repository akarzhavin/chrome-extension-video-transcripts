// Word lookup — hover a subtitle word for its translations, click through for
// the full entry in the sidebar.
//
// This file is the module's whole public surface. Everything the feature is
// lives under this directory; nothing outside it imports a file from inside,
// except tests, which reach internals by explicit path.
//
// Deliberately NOT re-exported wholesale from the package barrel: nothing
// secret lives here, but the barrel is the embed's surface too, and the embed
// has no service worker to route LOOKUP_WORD through. The barrel re-exports
// installLookupStrip by name and nothing else, which keeps the client, the
// cache and the word screen out of a bundle that could never use them.

// ── Wire contract ──────────────────────────────────────────────────────────
export type {
    LookupResult,
    LookupRequest,
    LookupExample,
    LookupSense,
    LookupPartOfSpeech,
} from './types';
export { LOOKUP_WORD_ACTION, MAX_LOOKUP_TERM_LEN, LOOKUP_TIMEOUT_MS } from './types';

// ── Network + cache (service worker only) ──────────────────────────────────
export { fetchLookup, lookupCached, clearLookupCache } from './client';

// ── Answer inspection (the message handler reports on both) ────────────────
export { hasLookupContent, latencyBucket } from './shape';

// ── UI surfaces ────────────────────────────────────────────────────────────
// The hover strip and the word screen join this façade in the steps that move
// them in; until then they are reached at their current homes.

// Everything else — stripTranslations, showsLemma, posTags, oxfordLookupUrl,
// isContextual, stripDefinition, posLabel, the icons, cacheKey — is internal
// to this module. It stays exported from its own file so tests can reach it by
// path, which is the same two-tier arrangement analytics-bg already uses.
