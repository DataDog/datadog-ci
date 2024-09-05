/* eslint-disable max-classes-per-file */

import {coerceError} from '../../helpers/errors'
import {isEndpointError, isForbiddenError} from './api'

const nonCriticalErrorCodes = ['NO_TESTS_TO_RUN', 'MISSING_TESTS'] as const
export type NonCriticalCiErrorCode = typeof nonCriticalErrorCodes[number]

const criticalErrorCodes = [
  'AUTHORIZATION_ERROR',
  'INVALID_CONFIG',
  'MISSING_API_KEY',
  'MISSING_APP_KEY',
  'POLL_RESULTS_FAILED',
  'BATCH_TIMEOUT_RUNAWAY',
  'TOO_MANY_TESTS_TO_TRIGGER',
  'TRIGGER_TESTS_FAILED',
  'TUNNEL_START_FAILED',
  'TUNNEL_NOT_SUPPORTED',
  'UNAVAILABLE_TEST_CONFIG',
  'UNAVAILABLE_TUNNEL_CONFIG',
  'UPLOAD_MOBILE_APPLICATION_TESTS_FAILED',
  'MISSING_MOBILE_APPLICATION_PATH',
  'MISSING_MOBILE_APPLICATION_ID',
  'MISSING_MOBILE_VERSION_NAME',
  'INVALID_MOBILE_APP',
  'INVALID_MOBILE_APP_UPLOAD_PARAMETERS',
  'MOBILE_APP_UPLOAD_TIMEOUT',
  'UNKNOWN_MOBILE_APP_UPLOAD_FAILURE',
  'UNKNOWN',
] as const
export type CriticalCiErrorCode = typeof criticalErrorCodes[number]

export type CiErrorCode = NonCriticalCiErrorCode | CriticalCiErrorCode

export class CiError extends Error {
  // TODO: Use native `cause` property when targeting Node.js 16
  constructor(public code: CiErrorCode, message?: string, public cause?: Error) {
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
  constructor(public code: CriticalCiErrorCode, cause?: string | Error) {
    const message = typeof cause === 'string' ? cause : cause?.message
    const error = cause instanceof Error ? cause : undefined

    super(code, message, error)
  }
}

export class BatchTimeoutRunawayError extends CriticalError {
  constructor() {
    super('BATCH_TIMEOUT_RUNAWAY', "The batch didn't timeout after the expected timeout period.")
  }
}

export function convertErrorToCiError(e: unknown): CiError {
  const error = coerceError(e)
  if (error instanceof CiError) {
    return error
  }

  if (isForbiddenError(error)) {
    return new CriticalError('AUTHORIZATION_ERROR', error)
  }

  if (isEndpointError(error)) {
    return new CriticalError('UNAVAILABLE_TEST_CONFIG', error)
  }

  return new CriticalError('UNKNOWN', error)
}
