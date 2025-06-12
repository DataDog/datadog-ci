import {AxiosError, default as axios} from 'axios'
import chalk from 'chalk'
import {BufferedMetricsLogger} from 'datadog-metrics'

import {InvalidConfigurationError} from './errors'

/** ApiKeyValidator is an helper interface to interpret Datadog error responses and possibly check the
 * validity of the api key.
 */
export interface ApiKeyValidator {
  verifyApiKey(error: AxiosError): Promise<void>
  validateApiKey(): Promise<boolean>
}

export interface ApiKeyValidatorParams {
  apiKey: string | undefined
  datadogSite: string
  metricsLogger?: BufferedMetricsLogger
}

export const newApiKeyValidator = (params: ApiKeyValidatorParams): ApiKeyValidator =>
  new ApiKeyValidatorImplem(params.apiKey, params.datadogSite, params.metricsLogger)

/** ApiKeyValidator is an helper class to interpret Datadog error responses and possibly check the
 * validity of the api key.
 */
class ApiKeyValidatorImplem {
  public apiKey: string | undefined
  public datadogSite: string

  private isValid?: boolean
  private metricsLogger?: BufferedMetricsLogger

  constructor(apiKey: string | undefined, datadogSite: string, metricsLogger?: BufferedMetricsLogger) {
    this.apiKey = apiKey
    this.datadogSite = datadogSite
    this.metricsLogger = metricsLogger
  }

  /** Check if an API key is valid, based on the Axios error and defaulting to verify the API key
   * through Datadog's API for ambiguous cases.
   * An exception is raised when the API key is invalid.
   * Callers should catch the exception to display it nicely.
   */
  public async verifyApiKey(error: AxiosError): Promise<void> {
    if (error.response === undefined) {
      return
    }
    if (error.response.status === 403 || (error.response.status === 400 && !(await this.isApiKeyValid()))) {
      if (this.metricsLogger !== undefined) {
        this.metricsLogger.increment('invalid_auth', 1)
      }
      throw new InvalidConfigurationError(
        `${chalk.red.bold('DATADOG_API_KEY')} does not contain a valid API key for Datadog site ${this.datadogSite}`
      )
    }
  }

  /**
   * Check if the API key is valid by making a request to the Datadog validate API.
   * @returns `true` if the API key is valid, `false` otherwise.
   */
  public async validateApiKey(): Promise<boolean> {
    try {
      const response = await axios.get(this.getApiKeyValidationURL(), {
        headers: {
          'DD-API-KEY': this.apiKey,
        },
      })

      return response.data.valid
    } catch (error) {
      if (error.response && error.response.status === 403) {
        return false
      }
      throw error
    }
  }

  private getApiKeyValidationURL(): string {
    return `https://api.${this.datadogSite}/api/v1/validate`
  }

  private async isApiKeyValid(): Promise<boolean | undefined> {
    if (this.isValid === undefined) {
      this.isValid = await this.validateApiKey()
    }

    return this.isValid
  }
}
