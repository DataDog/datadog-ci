import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import {isStandaloneBinary} from '../../../helpers/is-standalone-binary'
import {executePluginCommand} from '../../../helpers/plugin'

import {AuthLoginCommand} from '../login'

jest.mock('../../../helpers/plugin', () => ({executePluginCommand: jest.fn()}))
jest.mock('../../../helpers/is-standalone-binary', () => ({isStandaloneBinary: jest.fn()}))

const mockExecutePluginCommand = executePluginCommand as jest.MockedFunction<typeof executePluginCommand>
const mockIsStandaloneBinary = isStandaloneBinary as jest.MockedFunction<typeof isStandaloneBinary>

describe('auth login declaration', () => {
  const runCLI = makeRunCLI(AuthLoginCommand, ['auth', 'login'])

  beforeEach(() => {
    mockExecutePluginCommand.mockResolvedValue(0)
    mockIsStandaloneBinary.mockResolvedValue(false)
  })

  afterEach(() => jest.resetAllMocks())

  test('delegates to plugin without loading it for help', async () => {
    const {code} = await runCLI(['--help'])
    expect(code).toBe(0)
    expect(mockExecutePluginCommand).not.toHaveBeenCalled()
  })

  test('delegates parsed options to the plugin', async () => {
    const {code} = await runCLI(['--site', 'datadoghq.eu', '--scope', 'extra', '--no-browser'])
    expect(code).toBe(0)
    expect(mockExecutePluginCommand).toHaveBeenCalledWith(
      expect.objectContaining({browser: false, scopes: ['extra'], site: 'datadoghq.eu'})
    )
  })

  test('rejects conflicting browser options before plugin delegation', async () => {
    const {code, context} = await runCLI(['--browser', '--no-browser'])
    expect(code).toBe(1)
    expect(`${context.stdout.toString()}${context.stderr.toString()}`).toContain('cannot be used together')
    expect(mockExecutePluginCommand).not.toHaveBeenCalled()
  })

  test('rejects the official container distribution', async () => {
    const {code, context} = await runCLI([], {DD_CI_DISTRIBUTION: 'official-container'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('npm distribution')
    expect(mockExecutePluginCommand).not.toHaveBeenCalled()
  })

  test('rejects the standalone distribution', async () => {
    mockIsStandaloneBinary.mockResolvedValue(true)
    const {code, context} = await runCLI([])
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('npm distribution')
  })
})
