// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

const {readFileSync} = require('node:fs')

// Load e2e/.env.local if it exists (gitignored, for local non-secret overrides like DATADOG_CI_COMMAND)
// Secrets (DD_API_KEY, DATADOG_API_KEY, DATADOG_APP_KEY) must come from the environment -- use dd-auth:
//   dd-auth --domain <your-org-domain> -- yarn test:e2e
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

if (!process.env.DD_API_KEY && !process.env.DATADOG_API_KEY) {
  console.error('Missing DD_API_KEY / DATADOG_API_KEY. Run e2e tests via: dd-auth --domain <your-org-domain> -- yarn test:e2e')
  process.exit(1)
}

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
