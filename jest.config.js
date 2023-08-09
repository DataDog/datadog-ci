// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  roots: ['src'],
}
