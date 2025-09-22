// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Those commands are not supported in Windows.
  testPathIgnorePatterns: ['react-native', 'dsyms'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        isolatedModules: true,
      },
    ],
  },
  roots: ['<rootDir>/packages'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/packages/.*/dist'],
  moduleNameMapper: {
    '^@datadog/datadog-ci-plugin-([\\w-]+)(.*)$': '<rootDir>/packages/plugin-$1/src$2',
    '^@datadog/datadog-ci-base(.*)$': '<rootDir>/packages/base/src$1',
    '^@datadog/datadog-ci(.*)$': '<rootDir>/packages/datadog-ci/src$1',
  },
}
