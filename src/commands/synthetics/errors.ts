import chalk from 'chalk'
import {MainReporter} from './interfaces'

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

export const handleCiError = (error: CiError, reporter: MainReporter) => {
  switch (error.code) {
    case 'NO_TESTS_TO_RUN':
      reporter.log('No test to run.\n')
      break
    case 'MISSING_APP_KEY':
      reporter.error(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
      break
    case 'MISSING_API_KEY':
      reporter.error(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      break
    case 'POLL_RESULTS_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${error.message}\n\n`)
      break
    case 'TUNNEL_START_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to start tunnel')}\n${error.message}\n\n`)
      break
    case 'TRIGGER_TESTS_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to trigger tests')}\n${error.message}\n\n`)
      break
    case 'UNAVAILABLE_TEST_CONF':
      reporter.error(
        `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations with search query ')}\n${error.message}\n\n`
      )
      break
    case 'UNAVAILABLE_TUNNEL_CONF':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration')}\n${error.message}\n\n`)
  }
}
