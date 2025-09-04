// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path')

// Ensure tests that reference './src/...' run with CWD at the package root.
const pkgRoot = path.join(__dirname, 'packages/datadog-ci')
try {
  process.chdir(pkgRoot)
} catch (_) {
  // noop
}
