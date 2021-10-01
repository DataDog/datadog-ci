// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  testMatch: ['**/__tests__/**/*.test.ts'],
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/testEnvironment.js',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  roots: ['src'],
  setupFilesAfterEnv: ["jest-matcher-specific-error"]
}
