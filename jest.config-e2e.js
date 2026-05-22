// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

const {readFileSync} = require('node:fs')

// Load e2e/.env.local if it exists (gitignored, for local overrides)
try {
  for (const line of readFileSync('e2e/.env.local', 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/)
    if (match && !process.env[match[1]]) {
      let value = match[2]
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1)
      }
      process.env[match[1]] = value
    }
  }
} catch {}

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'e2e/tsconfig.json',
      },
    ],
  },
  roots: ['e2e'],
  testTimeout: 300_000,
}
