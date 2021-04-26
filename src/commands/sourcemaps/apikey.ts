import axios from 'axios'

export class ApiKeyValidator {
  public apiKey: string | undefined
  public datadogSite: string

  private isValid?: boolean

  constructor(apiKey: string | undefined, datadogSite: string) {
    this.apiKey = apiKey
    this.datadogSite = datadogSite
  }

  public async isApiKeyValid(): Promise<boolean | undefined> {
    if (this.isValid === undefined) {
      this.isValid = await this.validateApiKey()
    }

    return this.isValid!
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
      if (error.response && error.response.status === 403) {
        return false
      }
      throw error
    }
  }
}
