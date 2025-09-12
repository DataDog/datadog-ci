export const isStandaloneBinary = async () => {
  try {
    const {isSea} = await import('node:sea')

    return isSea()
  } catch {
    // Older versions of Node.js do not have the `node:sea` module.
    return false
  }
}
