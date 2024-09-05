export class InvalidConfigurationError extends Error {}

export class CoercedError extends Error {
  constructor(message: string, public originalType: string) {
    super(message)
  }
}

export const coerceError = (error: unknown): Error | CoercedError => {
  if (!!error && typeof error === 'object' && 'message' in error) {
    return error as Error
  } else {
    return new CoercedError(String(error), typeof error)
  }
}
