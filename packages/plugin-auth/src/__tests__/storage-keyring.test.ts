import {refreshAccessToken} from '../oauth'
import {getValidOAuthAccessToken, loadOAuthSession, saveOAuthSession} from '../storage'

const entries = new Map<string, string>()

jest.mock('@napi-rs/keyring', () => ({
  Entry: class {
    private readonly account: string

    constructor(_service: string, account: string) {
      this.account = account
    }

    public deletePassword() {
      entries.delete(this.account)
    }

    public getPassword() {
      // Match the native keyring API, which represents a missing credential with null.
      // eslint-disable-next-line no-null/no-null
      return entries.get(this.account) ?? null
    }

    public setPassword(password: string) {
      entries.set(this.account, password)
    }
  },
}))
jest.mock('../oauth', () => ({
  ...jest.requireActual('../oauth'),
  refreshAccessToken: jest.fn(),
}))

const mockRefreshAccessToken = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>

describe('OAuth keychain storage', () => {
  beforeEach(() => {
    entries.clear()
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'rotated-access',
      expiresIn: 3600,
      refreshToken: 'rotated-refresh',
      scope: ['new-scope'],
      tokenType: 'Bearer',
    })
  })

  afterEach(() => jest.restoreAllMocks())

  test('shards large records behind a manifest and reads them back', async () => {
    const session = {
      accessToken: 'a'.repeat(6000),
      clientId: 'client',
      expiresAt: Date.now() + 3600_000,
      refreshToken: 'refresh',
      scopes: ['scope'],
      site: 'datadoghq.com',
      tokenType: 'Bearer',
    }
    await saveOAuthSession(session)
    const manifest = JSON.parse(entries.get('oauth-session')!)
    expect(manifest).toEqual(expect.objectContaining({chunks: 3, version: 1}))
    expect([...entries.keys()].filter((key) => key.startsWith(`oauth-session:${manifest.generation}:`))).toHaveLength(3)
    await expect(loadOAuthSession()).resolves.toEqual(session)
  })

  test('reports a corrupt manifest explicitly', async () => {
    entries.set('oauth-session', '{')
    await expect(loadOAuthSession()).rejects.toThrow('manifest is corrupt')
  })

  test('refreshes and atomically persists tokens five minutes before expiry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await saveOAuthSession({
      accessToken: 'old-access',
      clientId: 'client',
      expiresAt: 1_000_000 + 5 * 60 * 1000,
      refreshToken: 'old-refresh',
      scopes: ['old-scope'],
      site: 'datadoghq.com',
      tokenType: 'Bearer',
    })
    const firstGeneration = JSON.parse(entries.get('oauth-session')!).generation
    await expect(getValidOAuthAccessToken()).resolves.toBe('rotated-access')
    expect(mockRefreshAccessToken).toHaveBeenCalledWith(expect.objectContaining({refreshToken: 'old-refresh'}))
    const secondGeneration = JSON.parse(entries.get('oauth-session')!).generation
    expect(secondGeneration).not.toBe(firstGeneration)
    await expect(loadOAuthSession()).resolves.toEqual(
      expect.objectContaining({accessToken: 'rotated-access', expiresAt: 4_600_000, refreshToken: 'rotated-refresh'})
    )
    expect([...entries.keys()].some((key) => key.includes(firstGeneration))).toBe(false)
  })
})
