/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
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
