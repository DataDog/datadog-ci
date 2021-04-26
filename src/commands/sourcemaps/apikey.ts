import axios from 'axios'

interface ApiKeyDict {
    [key: string]: boolean
}

class ApiKeyProvider {
  private static instance: ApiKeyProvider

  private datadogSite: string = process.env.DATADOG_SITE || 'datadoghq.com'
  private validatedApiKeys: ApiKeyDict

  private constructor() {
      this.validatedApiKeys = {}
  }

  public static getInstance(): ApiKeyProvider {
    if (!ApiKeyProvider.instance) {
      ApiKeyProvider.instance = new ApiKeyProvider()
    }

    return ApiKeyProvider.instance
  }

  public async isApiKeyValid(apiKey: string): Promise<boolean | undefined> {
    if (!this.validatedApiKeys.hasOwnProperty(apiKey)) {
        this.validatedApiKeys[apiKey] = await this.validateApiKey(apiKey)
    }

    return this.validatedApiKeys[apiKey]
  }

  private getApiKeyValidationURL(): string {
    return `https://api.${this.datadogSite}/api/v1/validate`
  }

  private async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await axios.get(this.getApiKeyValidationURL(), {
        headers: {
          'DD-API-KEY': apiKey,
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

// Making this function retrieve the value from env var each time (rather than reading it first
// and copying it into memory) allows us to change the env var at runtime during tests.
export const getApiKey: () => string | undefined = () => process.env.DATADOG_API_KEY

export const isApiKeyValid: (apiKey: string | undefined) => Promise<boolean> = async (apiKey) => {
  if (apiKey === undefined) {
      return false
  }

  return ApiKeyProvider.getInstance()
    .isApiKeyValid(apiKey!)
    .then((isValid) => isValid !== undefined && isValid)
}
