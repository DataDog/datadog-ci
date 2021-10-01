/* tslint:disable:max-classes-per-file */
const ciErrorCodes = [
  'UNAVAILABLE_TEST_CONF',
  'MISSING_API_KEY',
  'MISSING_APP_KEY',
  'NO_TESTS_TO_RUN',
  'UNAVAILABLE_TUNNEL_CONF',
  'TUNNEL_START_FAILED',
  'TRIGGER_TESTS_FAILED',
  'POLL_RESULTS_FAILED',
] as const
type CiErrorCode = typeof ciErrorCodes[number]

export class CiError extends Error {
  public code: CiErrorCode

  constructor(code: CiErrorCode) {
    super()
    this.code = code
  }
}

export class CriticalError extends CiError {}
