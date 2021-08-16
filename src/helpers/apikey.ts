import {AxiosError, default as axios} from 'axios'
import chalk from 'chalk'

import {InvalidConfigurationError} from './errors'
import {MetricCounter} from './utils'

export class ApiKeyValidator {
  public apiKey: string | undefined
  public datadogSite: string

  private isValid?: boolean

  constructor(apiKey: string | undefined, datadogSite: string) {
    this.apiKey = apiKey
    this.datadogSite = datadogSite
  }

  public async verifyApiKey(error: AxiosError, metricCounter: MetricCounter): Promise<void> {
    if (error.response === undefined) {

      return
    }
    if (
      error.response.status === 403 || (
        error.response.status === 400 &&
        !(await this.isApiKeyValid())
      )
    ) {
      metricCounter('invalid_auth', 1)
      throw new InvalidConfigurationError(
        `${chalk.red.bold('DATADOG_API_KEY')} does not contain a valid API key for Datadog site ${this.datadogSite
        }`
      )
    }
  }

  private getApiKeyValidationURL(): string {
    return `https://api.${this.datadogSite}/api/v1/validate`
  }

  private async isApiKeyValid(): Promise<boolean | undefined> {
    if (this.isValid === undefined) {
      this.isValid = await this.validateApiKey()
    }

    return this.isValid!
  }

  private async validateApiKey(): Promise<boolean> {
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
}
