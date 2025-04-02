const path = require('path')

// For reference, see default resolver implementation: https://github.com/jestjs/jest/blob/9ea3e0fe3d040a130600758c19cd8ff5f56066fc/packages/jest-snapshot/src/SnapshotResolver.ts#L59-L80

const CUSTOM_WIN_EXTENSION = '.win.snap'

/** @type {import('jest-snapshot').SnapshotResolver} */
module.exports = {
  resolveSnapshotPath: (testPath) => {
    // e.g. `src/commands/synthetics/__tests__/utils/public.test.ts` --> `src/commands/synthetics/__tests__/utils/__snapshots__/public.test.ts.win.snap`
    return path.join(path.join(path.dirname(testPath), '__snapshots__'), path.basename(testPath) + CUSTOM_WIN_EXTENSION)
  },

  resolveTestPath: (snapshotPath) => {
    // e.g. `src/commands/synthetics/__tests__/utils/__snapshots__/public.test.ts.win.snap` --> `src/commands/synthetics/__tests__/utils/public.test.ts`
    return path.join(path.dirname(snapshotPath), '..', path.basename(snapshotPath, CUSTOM_WIN_EXTENSION))
  },

  /**
   * Example test path, used for preflight consistency check of the implementation above.
   * It checks that `resolveSnapshotPath(resolveTestPath(path))` is the same as `path`.
   */
  testPathForConsistencyCheck: 'src/commands/synthetics/__tests__/utils/public.test.ts',
}
