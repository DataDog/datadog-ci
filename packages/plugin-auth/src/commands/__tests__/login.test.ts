import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {readManualCallback, startCallbackServer} from '../../callback'
import {openBrowser, shouldOpenBrowser} from '../../environment'
import {exchangeAuthorizationCode, getCurrentUser, registerClient} from '../../oauth'
import {saveOAuthSession} from '../../storage'

import {PluginCommand} from '../login'

jest.mock('../../callback', () => ({
  ...jest.requireActual('../../callback'),
  readManualCallback: jest.fn(),
  startCallbackServer: jest.fn(),
}))
jest.mock('../../environment', () => ({openBrowser: jest.fn(), shouldOpenBrowser: jest.fn()}))
jest.mock('../../oauth', () => ({
  ...jest.requireActual('../../oauth'),
  createPKCE: jest.fn(() => ({challenge: 'challenge', verifier: 'verifier'})),
  createState: jest.fn(() => 'state'),
  exchangeAuthorizationCode: jest.fn(),
  getCurrentUser: jest.fn(),
  registerClient: jest.fn(),
}))
jest.mock('../../storage', () => ({saveOAuthSession: jest.fn()}))

const mockReadManualCallback = readManualCallback as jest.MockedFunction<typeof readManualCallback>
const mockStartCallbackServer = startCallbackServer as jest.MockedFunction<typeof startCallbackServer>
const mockOpenBrowser = openBrowser as jest.MockedFunction<typeof openBrowser>
const mockShouldOpenBrowser = shouldOpenBrowser as jest.MockedFunction<typeof shouldOpenBrowser>
const mockExchangeAuthorizationCode = exchangeAuthorizationCode as jest.MockedFunction<typeof exchangeAuthorizationCode>
const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>
const mockRegisterClient = registerClient as jest.MockedFunction<typeof registerClient>
const mockSaveOAuthSession = saveOAuthSession as jest.MockedFunction<typeof saveOAuthSession>

describe('auth login command', () => {
  const close = jest.fn(async () => undefined)

  beforeEach(() => {
    mockStartCallbackServer.mockResolvedValue({
      callback: Promise.resolve({code: 'code'}),
      close,
      port: 8000,
    })
    mockRegisterClient.mockResolvedValue('client')
    mockExchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-secret',
      expiresIn: 3600,
      refreshToken: 'refresh-secret',
      scope: ['user_self_profile_read'],
      tokenType: 'Bearer',
    })
    mockGetCurrentUser.mockResolvedValue({email: 'person@example.com', name: 'Person'})
    mockSaveOAuthSession.mockResolvedValue(undefined)
    mockOpenBrowser.mockResolvedValue(undefined)
    mockShouldOpenBrowser.mockReturnValue(true)
  })

  afterEach(() => jest.clearAllMocks())

  test('opens the browser, validates the user, persists the session, and cleans up', async () => {
    const command = createCommand(PluginCommand)
    await expect(command.execute()).resolves.toBe(0)
    expect(mockOpenBrowser).toHaveBeenCalledWith(expect.stringContaining('/oauth2/v1/authorize?'))
    expect(mockGetCurrentUser).toHaveBeenCalledWith('datadoghq.com', 'access-secret')
    expect(mockSaveOAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client',
        site: 'datadoghq.com',
        user: {email: 'person@example.com', name: 'Person'},
      }),
      expect.any(Function)
    )
    expect(close).toHaveBeenCalled()
    const output = `${command.context.stdout.toString()}${command.context.stderr.toString()}`
    expect(output).toContain('Authenticated as person@example.com on datadoghq.com')
    expect(output).not.toContain('access-secret')
    expect(output).not.toContain('refresh-secret')
  })

  test('uses pasted callback input in an automatically detected browserless environment', async () => {
    mockShouldOpenBrowser.mockReturnValue(false)
    mockStartCallbackServer.mockResolvedValue({callback: new Promise(() => undefined), close, port: 8000})
    mockReadManualCallback.mockResolvedValue({code: 'manual-code', domain: 'datadoghq.eu'})
    const command = createCommand(PluginCommand)
    await expect(command.execute()).resolves.toBe(0)
    expect(mockOpenBrowser).not.toHaveBeenCalled()
    expect(mockReadManualCallback).toHaveBeenCalled()
    expect(mockExchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({code: 'manual-code', site: 'datadoghq.eu'})
    )
    expect(command.context.stdout.toString()).toContain('The localhost page may fail to load')
  })

  test('falls back to pasted callback input when opening the browser fails', async () => {
    mockOpenBrowser.mockRejectedValue(new Error('no browser'))
    mockStartCallbackServer.mockResolvedValue({callback: new Promise(() => undefined), close, port: 8000})
    mockReadManualCallback.mockResolvedValue({code: 'manual-code'})
    const command = createCommand(PluginCommand)
    await expect(command.execute()).resolves.toBe(0)
    expect(command.context.stderr.toString()).toContain('switching to manual login')
    expect(mockReadManualCallback).toHaveBeenCalled()
  })

  test('rejects a returned custom domain before token exchange', async () => {
    mockStartCallbackServer.mockResolvedValue({
      callback: Promise.resolve({code: 'code', domain: 'attacker.example'}),
      close,
      port: 8000,
    })
    const command = createCommand(PluginCommand)
    await expect(command.execute()).resolves.toBe(1)
    expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(command.context.stderr.toString()).toContain('Unsupported Datadog site')
  })
})
