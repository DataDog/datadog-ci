/* tslint:disable:max-classes-per-file */
const nonCriticalErrorCodes = ['NO_TESTS_TO_RUN', 'NO_RESULTS_TO_POLL'] as const
export type NonCriticalCiErrorCode = typeof nonCriticalErrorCodes[number]

const criticalErrorCodes = [
  'AUTHORIZATION_ERROR',
  'MISSING_API_KEY',
  'MISSING_APP_KEY',
  'POLL_RESULTS_FAILED',
  'TRIGGER_TESTS_FAILED',
  'TUNNEL_START_FAILED',
  'UNAVAILABLE_TEST_CONFIG',
  'UNAVAILABLE_TUNNEL_CONFIG',
] as const
export type CriticalCiErrorCode = typeof criticalErrorCodes[number]

export type CiErrorCode = NonCriticalCiErrorCode | CriticalCiErrorCode

export class CiError extends Error {
  constructor(public code: CiErrorCode) {
    super()
  }
}

export class CriticalError extends CiError {
  constructor(public code: CriticalCiErrorCode) {
    super(code)
  }
}
