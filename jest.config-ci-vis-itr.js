module.exports = {
  clearMocks: true,
  testMatch: ['**/__tests__/**/*.test.ts'],
  preset: 'ts-jest',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  roots: ['src'],
  setupFilesAfterEnv: ['jest-matcher-specific-error'],
  collectCoverage: true
}
