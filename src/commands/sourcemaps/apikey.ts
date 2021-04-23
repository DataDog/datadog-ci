import axios from 'axios'

class ApiKeyProvider {
  private static instance: ApiKeyProvider

  public apiKey: string | undefined = process.env.DATADOG_API_KEY

  private apiKeyValid?: boolean
  private datadogSite: string = process.env.DATADOG_SITE || 'datadoghq.com'

  private constructor() {}

  public static getInstance(): ApiKeyProvider {
    if (!ApiKeyProvider.instance) {
      ApiKeyProvider.instance = new ApiKeyProvider()
    }

    return ApiKeyProvider.instance
  }

  public async isApiKeyValid(): Promise<boolean | undefined> {
    if (this.apiKeyValid === undefined) {
      this.apiKeyValid = await this.validateApiKey()
    }

    return this.apiKeyValid
  }

  private getApiKeyValidationURL(): string {
    return `https://api.${this.datadogSite}/api/v1/validate`
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
      if (error.response && error.response.stats === 403) {
        return false
      }

      return false
    }
  }
}

export const getApiKey: () => string | undefined = () => ApiKeyProvider.getInstance().apiKey

export const isApiKeyValid: () => Promise<boolean> = () =>
  ApiKeyProvider.getInstance()
    .isApiKeyValid()
    .then((isValid) => isValid !== undefined && isValid)
