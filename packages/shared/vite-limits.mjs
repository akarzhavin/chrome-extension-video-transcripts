// Loads infrastructure/lingogram-limits.json at vite-config eval time and
// produces a `define` map that injects them as build-time constants. The
// canonical source lives in the infrastructure submodule of the parent
// monorepo; when this repo is checked out standalone, we fall back to
// defaults so the extension can still be built (e.g. for CI smoke tests).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// packages/shared/ → packages/ → video-transcripts/ → chrome-extensions/ → english/
const LIMITS_PATH = resolve(HERE, '../../../../infrastructure/lingogram-limits.json');

const DEFAULTS = {
    MAX_WORDS_PER_DAY: 500,
    MIN_INTERVAL_MS: 1000,
    MAX_TERM_BYTES: 256,
    MAX_SOURCE_URL_BYTES: 2048,
    MAX_CONTEXT_BYTES: 2048,
    MAX_TITLE_BYTES: 512,
    ALLOWED_SOURCES: ['rezka-extension', 'youtube-extension', 'web-extension'],
};

export function loadLingogramLimits() {
    if (!existsSync(LIMITS_PATH)) {
        console.warn(`[vite-limits] ${LIMITS_PATH} not found — using fallback defaults (standalone build).`);
        return DEFAULTS;
    }
    const json = JSON.parse(readFileSync(LIMITS_PATH, 'utf8'));
    // Drop the JSON-with-comments sentinel field if present.
    delete json['$comment'];
    return { ...DEFAULTS, ...json };
}

export function limitDefines(limits) {
    return {
        __LIMIT_MAX_WORDS_PER_DAY__: JSON.stringify(limits.MAX_WORDS_PER_DAY),
        __LIMIT_MIN_INTERVAL_MS__: JSON.stringify(limits.MIN_INTERVAL_MS),
        __LIMIT_MAX_TERM_BYTES__: JSON.stringify(limits.MAX_TERM_BYTES),
        __LIMIT_MAX_SOURCE_URL_BYTES__: JSON.stringify(limits.MAX_SOURCE_URL_BYTES),
        __LIMIT_MAX_CONTEXT_BYTES__: JSON.stringify(limits.MAX_CONTEXT_BYTES),
        __LIMIT_MAX_TITLE_BYTES__: JSON.stringify(limits.MAX_TITLE_BYTES),
    };
}

export function assertSourceAllowed(limits, extSource) {
    if (!Array.isArray(limits.ALLOWED_SOURCES) || !limits.ALLOWED_SOURCES.includes(extSource)) {
        throw new Error(
            `[vite-limits] EXT_SOURCE "${extSource}" is not in lingogram-limits.json ` +
                `ALLOWED_SOURCES (${JSON.stringify(limits.ALLOWED_SOURCES)}). ` +
                `Firestore rules would reject every word write.`,
        );
    }
}
