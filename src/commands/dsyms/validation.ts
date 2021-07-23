import {statSync} from 'fs'

export const checkNonEmptyFile = (path: string) => {
  try {
    const stats = statSync(path)

    return stats.size !== 0
  } catch (error) {
    // Log to console "file exists yet empty" ?
    return false
  }
}
