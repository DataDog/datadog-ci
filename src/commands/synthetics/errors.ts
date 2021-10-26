import chalk from 'chalk'

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
  constructor(public code: CiErrorCode, message?: string) {
    super(message)
    switch (code) {
      case 'NO_RESULTS_TO_POLL':
        this.message = 'No results to poll.'
        break
      case 'NO_TESTS_TO_RUN':
        this.message = 'No test to run.'
        break
      case 'MISSING_APP_KEY':
        this.message = `Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`
        break
      case 'MISSING_API_KEY':
        this.message = `Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`
        break
      case 'POLL_RESULTS_FAILED':
        this.message = `\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${message}\n\n`
        break
      case 'TUNNEL_START_FAILED':
        this.message = `\n${chalk.bgRed.bold(' ERROR: unable to start tunnel')}\n${message}\n\n`
        break
      case 'TRIGGER_TESTS_FAILED':
        this.message = `\n${chalk.bgRed.bold(' ERROR: unable to trigger tests')}\n${message}\n\n`
        break
      case 'UNAVAILABLE_TEST_CONFIG':
        this.message = `\n${chalk.bgRed.bold(
          ' ERROR: unable to obtain test configurations with search query '
        )}\n${message}\n\n`
        break
      case 'UNAVAILABLE_TUNNEL_CONFIG':
        this.message = `\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration')}\n${message}\n\n`
    }
  }
}

export class CriticalError extends CiError {}
