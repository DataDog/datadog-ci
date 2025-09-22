export const isStandaloneBinary = async () => {
  try {
    // @ts-expect-error The types for `node:sea` are defined in `@types/node@^20.19.13` but moving from `^18.19.76` to `^20.19.13` makes the build fail. We'll ignore the error for now.
    const {isSea} = await import('node:sea')

    return isSea()
  } catch {
    // Older versions of Node.js do not have the `node:sea` module.
    return false
  }
}
