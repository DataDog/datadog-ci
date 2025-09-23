// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

import baseConfig from './jest.config.mjs'

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...baseConfig,
  // Those commands are not supported in Windows.
  testPathIgnorePatterns: ['react-native', 'dsyms'],
}
