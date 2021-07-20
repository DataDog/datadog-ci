import fs from 'fs'

export class InvalidPayload extends Error {
  public reason: string

  constructor(reason: string, message?: string) {
    super(message)
    this.reason = reason
  }
}

export const checkNonEmptyFile = (path: string) => {
  try {
    const stats = fs.statSync(path)

    return stats.size !== 0
  } catch (error) {
    // Log to console "file exists yet empty"
    return false
  }
}
