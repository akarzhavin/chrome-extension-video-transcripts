/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    // Git worktrees under .claude/worktrees are parallel checkouts (other
    // sessions' work). Scanning them makes every package name ambiguous in the
    // Haste map and runs someone else's suites; ignore the whole tree.
    // /e2e/ is a second runner (Playwright) driving a live browser; Jest can
    // neither run nor typecheck it, and a suite count that moves is
    // indistinguishable from a group silently dying.
    testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/e2e/'],
    modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/apps/rezka/tests/jest.setup.ts'],
  // Analytics is the one subsystem whose failure mode is silent (a wrong
  // payload is accepted by GA4 with a 204 and simply never appears in a
  // report), so its coverage is a gate rather than a statistic.
  collectCoverageFrom: [
    'packages/shared/src/analytics.ts',
    'packages/shared/src/analytics-bg.ts',
  ],
  coverageThreshold: {
    'packages/shared/src/analytics.ts': { branches: 90, lines: 95 },
    'packages/shared/src/analytics-bg.ts': { branches: 90, lines: 95 },
  },
};
