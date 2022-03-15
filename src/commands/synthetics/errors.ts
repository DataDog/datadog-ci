/* tslint:disable:max-classes-per-file */
const nonCriticalErrorCodes = ['NO_TESTS_TO_RUN', 'NO_RESULTS_TO_POLL'] as const
type NonCriticalCiErrorCode = typeof nonCriticalErrorCodes[number]

const criticalErrorCodes = [
  'UNAVAILABLE_TEST_CONFIG',
  'MISSING_API_KEY',
  'MISSING_APP_KEY',
  'UNAVAILABLE_TUNNEL_CONFIG',
  'TUNNEL_START_FAILED',
  'TRIGGER_TESTS_FAILED',
  'POLL_RESULTS_FAILED',
] as const
type CriticalCiErrorCode = typeof criticalErrorCodes[number]

type CiErrorCode = NonCriticalCiErrorCode | CriticalCiErrorCode

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
