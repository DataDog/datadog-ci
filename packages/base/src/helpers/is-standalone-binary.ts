export const isStandaloneBinary = async () => {
  try {
    // Support for `pkg` with `--sea` flag, which uses `node --experimental-sea-mode` under the hood.
    const {isSea} = await import('node:sea')

    return isSea()
  } catch {
    // Support for `pkg` without `--sea` flag, a.k.a. "Standard mode"
    // https://yao-pkg.github.io/pkg/guide/snapshot-fs#detecting-that-you-re-packaged
    if ((process as any).pkg !== undefined) {
      return true
    }

    // Older versions of Node.js do not have the `node:sea` module.
    return false
  }
}
