import {stripVTControlCharacters} from 'util'

import {
  AUTH_HELP,
  getAccessTokenFromEnv,
  getMissingOrgCredentialsMessage,
  getCloudCredentialsOnlyAuthHelp,
  getFlareAuthHelp,
  getServerlessInstrumentAuthHelp,
  resolveOrgCredentials,
} from '../auth'

describe('auth', () => {
  describe('getAccessTokenFromEnv', () => {
    test('prefers DATADOG_ACCESS_TOKEN over DD_ACCESS_TOKEN', () => {
      expect(getAccessTokenFromEnv({DATADOG_ACCESS_TOKEN: 'datadog', DD_ACCESS_TOKEN: 'dd'})).toBe('datadog')
    })

    test('falls back to DD_ACCESS_TOKEN', () => {
      expect(getAccessTokenFromEnv({DATADOG_ACCESS_TOKEN: '', DD_ACCESS_TOKEN: 'dd'})).toBe('dd')
    })

    test('returns undefined when no token is set', () => {
      expect(getAccessTokenFromEnv({DD_ACCESS_TOKEN: ''})).toBeUndefined()
    })
  })

  describe('resolveOrgCredentials', () => {
    test('drops the application key when an access token is set', () => {
      expect(resolveOrgCredentials({accessToken: 'token', apiKey: 'api', appKey: 'app'})).toStrictEqual({
        accessToken: 'token',
        apiKey: 'api',
      })
    })

    test('keeps the API key and the application key without an access token', () => {
      expect(resolveOrgCredentials({apiKey: 'api', appKey: 'app'})).toStrictEqual({apiKey: 'api', appKey: 'app'})
    })

    test('normalizes empty values to undefined', () => {
      expect(resolveOrgCredentials({accessToken: '', apiKey: '', appKey: ''})).toStrictEqual({
        apiKey: undefined,
        appKey: undefined,
      })
    })
  })

  describe('getMissingOrgCredentialsMessage', () => {
    test('accepts an access token alone', () => {
      expect(getMissingOrgCredentialsMessage('sbom upload', {accessToken: 'token'})).toBeUndefined()
    })

    test('accepts an API key and an application key', () => {
      expect(getMissingOrgCredentialsMessage('sbom upload', {apiKey: 'api', appKey: 'app'})).toBeUndefined()
    })

    test('explains that an intake mapping API key is not enough', () => {
      const message = getMissingOrgCredentialsMessage('sbom upload', {apiKey: 'api'})
      expect(message).toContain(
        '`sbom upload` needs an application key (DD_APP_KEY) or an access token (DD_ACCESS_TOKEN).'
      )
      expect(message).toContain('An intake mapping only provides an API key')
      expect(message).toContain('identity mapping')
    })

    test('asks for an API key or an access token when only an application key is set', () => {
      expect(getMissingOrgCredentialsMessage('deployment gate', {appKey: 'app'})).toContain(
        '`deployment gate` needs an API key (DD_API_KEY) to go with the application key, or an access token (DD_ACCESS_TOKEN).'
      )
    })

    test('lists both options when nothing is set', () => {
      expect(getMissingOrgCredentialsMessage('gate evaluate', {})).toContain(
        '`gate evaluate` needs an access token (DD_ACCESS_TOKEN), or an API key (DD_API_KEY) and an application key (DD_APP_KEY).'
      )
    })
  })

  describe('help texts', () => {
    test('link Workload Identity Federation to its docs', () => {
      for (const text of [AUTH_HELP.apiKey, AUTH_HELP.orgAction]) {
        expect(stripVTControlCharacters(text)).toContain('Workload Identity Federation')
        expect(text).toContain('https://docs.datadoghq.com/account_management/workload_identity_federation/')
      }
    })

    test('all start with "This command" and end with the README link', () => {
      for (const text of [
        ...Object.values(AUTH_HELP),
        getServerlessInstrumentAuthHelp('AWS credentials', 'a Datadog API key (DD_API_KEY)'),
        getCloudCredentialsOnlyAuthHelp('AWS credentials'),
        getFlareAuthHelp('AWS credentials'),
      ]) {
        expect(stripVTControlCharacters(text)).toMatch(/^This command /)
        expect(stripVTControlCharacters(text)).toMatch(
          /\n\nSee\nhttps:\/\/github\.com\/DataDog\/datadog-ci#authentication$/
        )
        expect(stripVTControlCharacters(text)).not.toMatch(/\*\*|`/)
      }
    })
  })
})
