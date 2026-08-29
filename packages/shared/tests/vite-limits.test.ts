/**
 * The fallback limits, checked against the canonical file they shadow.
 *
 * loadLingogramLimits() reads infrastructure/lingogram-limits.json when the
 * monorepo is checked out beside this one, and silently falls back to a
 * hardcoded DEFAULTS object when it is not. The site's CI is exactly that
 * case: it fetches this repo from GitHub on its own, so every site build in
 * CI runs on DEFAULTS.
 *
 * That makes the two lists a contract, not a convenience. When ALLOWED_SOURCES
 * gained "site-uninstall" in the canonical file and not here, local builds
 * passed and the PreProd deploy died inside assertSourceAllowed — the guard
 * firing correctly on a stale copy of the thing it guards.
 *
 * Skipped, not failed, when the infrastructure repo is absent: a standalone
 * checkout has nothing to compare against, and failing there would punish the
 * very layout the fallback exists to support.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const VITE_LIMITS = resolve(__dirname, '../vite-limits.mjs');

// The same two candidates vite-limits.mjs itself tries, resolved relative to
// ITS directory (one level up from this one) so the two stay in step.
const SHARED_DIR = resolve(__dirname, '..');
const CANONICAL = [
    resolve(SHARED_DIR, '../../../../infrastructure/lingogram-limits.json'),
    resolve(SHARED_DIR, '../../../../english/infrastructure/lingogram-limits.json'),
].find((p) => existsSync(p));

/**
 * The fallback as a standalone build actually sees it.
 *
 * Copied to a temp directory first, and that is the whole trick: the module
 * probes for the canonical file at fixed paths RELATIVE TO ITSELF, and
 * LINGOGRAM_LIMITS_PATH is only the first of those candidates. Pointing that
 * variable at nothing therefore proves nothing here — the module simply falls
 * through to the real file sitting beside this checkout, and the fallback is
 * never exercised. Somewhere with no infrastructure repo above it, it is.
 *
 * A subprocess, not an import: the module is ESM and jest runs these as CJS.
 */
function loadFallback(): Record<string, any> {
    const dir = mkdtempSync(join(tmpdir(), 'vite-limits-'));
    try {
        const copy = join(dir, 'vite-limits.mjs');
        copyFileSync(VITE_LIMITS, copy);
        const out = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import { loadLingogramLimits } from ${JSON.stringify(copy)};` +
                    'console.log(JSON.stringify(loadLingogramLimits()));',
            ],
            {
                encoding: 'utf8',
                // Strip the override too, or a developer who has it exported
                // would silently test the real file instead of the fallback.
                env: { ...process.env, LINGOGRAM_LIMITS_PATH: '' },
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        );
        return JSON.parse(out);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const describeIfCanonical = CANONICAL ? describe : describe.skip;

describeIfCanonical('DEFAULTS mirror lingogram-limits.json', () => {
    const canonical = JSON.parse(readFileSync(CANONICAL as string, 'utf8'));
    const fallback = loadFallback();

    it('allows exactly the same sources', () => {
        // Order-insensitive: the lists are membership tests, not sequences.
        expect([...fallback.ALLOWED_SOURCES].sort()).toEqual(
            [...canonical.ALLOWED_SOURCES].sort(),
        );
    });

    it.each([
        'MAX_WORDS_PER_DAY',
        'MIN_INTERVAL_MS',
        'MAX_TERM_BYTES',
        'MAX_SOURCE_URL_BYTES',
        'MAX_CONTEXT_BYTES',
        'MAX_TITLE_BYTES',
        'MAX_FEEDBACK_TEXT_BYTES',
    ])('agrees on %s', (key) => {
        expect(fallback[key]).toBe(canonical[key]);
    });
});

describe('the fallback itself', () => {
    it('always carries a usable source list', () => {
        const limits = loadFallback();
        expect(Array.isArray(limits.ALLOWED_SOURCES)).toBe(true);
        expect(limits.ALLOWED_SOURCES.length).toBeGreaterThan(0);
    });

    it('includes the source the site build stamps', () => {
        // The site's CI builds this repo alone, so this is the list
        // assertSourceAllowed checks there.
        expect(loadFallback().ALLOWED_SOURCES).toContain('site-uninstall');
    });
});
