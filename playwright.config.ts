import { defineConfig } from '@playwright/test';

/**
 * Live e2e against the human's signed-in Chrome over the debugging port.
 *
 * Deliberately NOT wired to CI: it needs a real signed-in browser, and a CI job
 * that cannot run it would report green having run nothing — the exact failure
 * Principle III exists to prevent.
 */
export default defineConfig({
    testDir: './e2e',
    // One shared browser, and parallel tabs would fight over the extension
    // reload the fixture performs.
    workers: 1,
    fullyParallel: false,
    // Live subtitle loading is genuinely flaky for environmental reasons: three
    // consecutive runs produced three different outcomes with no code change.
    // One retry separates flake from breakage.
    retries: 1,
    // A check that has not finished in three minutes is not slow, it is wedged:
    // the longest genuine one takes about ninety seconds. Observed once — the
    // browser stopped answering mid-run and a single check sat for half an hour
    // while the other forty-four never started. Failing that one is far cheaper
    // than losing the run.
    timeout: 180_000,
    expect: { timeout: 30_000 },
    reporter: [['list']],
    use: { trace: 'on-first-retry' },
});
