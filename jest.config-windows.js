// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
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
      },
    ],
  },
  roots: ['packages'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Fix `duplicate manual mock found` where `src` and `dist` are both imported.
  modulePathIgnorePatterns: ['<rootDir>/packages/.*/dist'],
}
