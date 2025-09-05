export type NonCriticalCiErrorCode = 'NO_TESTS_TO_RUN' | 'MISSING_TESTS' | 'UNAUTHORIZED_TESTS'

export type CriticalCiErrorCode =
  | 'AUTHORIZATION_ERROR'
  | 'INVALID_CONFIG'
  | 'MISSING_API_KEY'
  | 'MISSING_APP_KEY'
  | 'POLL_RESULTS_FAILED'
  | 'BATCH_TIMEOUT_RUNAWAY'
  | 'TOO_MANY_TESTS_TO_TRIGGER'
  | 'TRIGGER_TESTS_FAILED'
  | 'TUNNEL_START_FAILED'
  | 'TUNNEL_NOT_SUPPORTED'
  | 'UNAVAILABLE_TEST_CONFIG'
  | 'UNAVAILABLE_TUNNEL_CONFIG'
  | 'UPLOAD_MOBILE_APPLICATION_TESTS_FAILED'
  | 'MISSING_MOBILE_APPLICATION_PATH'
  | 'MISSING_MOBILE_APPLICATION_ID'
  | 'MISSING_MOBILE_VERSION_NAME'
  | 'INVALID_MOBILE_APP'
  | 'INVALID_MOBILE_APP_UPLOAD_PARAMETERS'
  | 'MOBILE_APP_UPLOAD_TIMEOUT'
  | 'UNKNOWN_MOBILE_APP_UPLOAD_FAILURE'
  | 'LTD_MULTILOCATORS_UPDATE_FAILED'

export type CiErrorCode = NonCriticalCiErrorCode | CriticalCiErrorCode

export class CiError extends Error {
  constructor(public code: CiErrorCode, message?: string) {
    super(message)
  }

  public toJson() {
    return {
      code: this.code,
      message: this.message,
    }
  }
}

export class CriticalError extends CiError {
  constructor(public code: CriticalCiErrorCode, message?: string) {
    super(code, message)
  }
}

export class BatchTimeoutRunawayError extends CriticalError {
  constructor() {
    super('BATCH_TIMEOUT_RUNAWAY', "The batch didn't timeout after the expected timeout period.")
  }
}
