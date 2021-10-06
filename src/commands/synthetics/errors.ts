/* tslint:disable:max-classes-per-file */
const ciErrorCodes = [
  'UNAVAILABLE_TEST_CONFIG',
  'MISSING_API_KEY',
  'MISSING_APP_KEY',
  'NO_RESULTS_TO_POLL',
  'NO_TESTS_TO_RUN',
  'UNAVAILABLE_TUNNEL_CONFIG',
  'TUNNEL_START_FAILED',
  'TRIGGER_TESTS_FAILED',
  'POLL_RESULTS_FAILED',
] as const
type CiErrorCode = typeof ciErrorCodes[number]

export class CiError extends Error {
  constructor(public code: CiErrorCode) {
    super()
  }
}

export class CriticalError extends CiError {}
