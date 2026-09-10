import {storageInternals} from '../storage'

const validSession = {
  accessToken: 'access',
  clientId: 'client',
  expiresAt: 123,
  refreshToken: 'refresh',
  scopes: ['scope'],
  site: 'datadoghq.com',
  tokenType: 'Bearer',
}

describe('OAuth storage', () => {
  test('uses platform configuration paths', () => {
    expect(storageInternals.getConfigFile({APPDATA: 'C:\\Users\\me\\AppData'}, 'win32')).toContain('datadog-ci')
    expect(storageInternals.getConfigFile({XDG_CONFIG_HOME: '/config'}, 'linux')).toBe('/config/datadog-ci/oauth.json')
    expect(storageInternals.getConfigFile({}, 'darwin')).toContain('Library/Application Support/datadog-ci/oauth.json')
  })

  test('parses a complete session and rejects partial records', () => {
    expect(storageInternals.parseSession(JSON.stringify(validSession))).toEqual(validSession)
    expect(() => storageInternals.parseSession(JSON.stringify({accessToken: 'only'}))).toThrow('corrupt or incomplete')
    expect(() => storageInternals.parseSession('{')).toThrow('corrupt or incomplete')
  })
})
