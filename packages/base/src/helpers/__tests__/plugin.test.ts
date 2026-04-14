import {SyntheticsRunTestsCommand} from '../../commands/synthetics/run-tests'

import {isStandaloneBinary} from '../is-standalone-binary'
import {messageBox} from '../message-box'
import * as pluginModule from '../plugin'
import {
  checkPlugin,
  getTempPath,
  installPlugin,
  listAllPlugins,
  executePluginCommand,
  VERSION_OVERRIDE_REGEX,
} from '../plugin'
import {getUserAgent} from '../user-agent'

import {createCommand} from './testing-tools'

jest.mock('node:child_process')
jest.mock('../is-standalone-binary')
jest.mock('../message-box')
jest.mock('../../version', () => ({
  cliVersion: '1.0.0',
}))
jest.mock('@datadog/datadog-ci-base/package.json', () => ({
  peerDependencies: {
    '@datadog/datadog-ci-plugin-test': '1.0.0',
    '@datadog/datadog-ci-plugin-another': '1.0.0',
    '@datadog/datadog-ci-plugin-synthetics': '1.0.0',
  },
}))

const mockIsStandaloneBinary = isStandaloneBinary as jest.MockedFunction<typeof isStandaloneBinary>
const mockMessageBox = messageBox as jest.MockedFunction<typeof messageBox>
const mockImportInstallPkg = jest.spyOn(pluginModule, 'importInstallPkg')

describe('listAllPlugins', () => {
  test('returns array of peer dependency keys', () => {
    const plugins = listAllPlugins()
    expect(plugins).toEqual([
      '@datadog/datadog-ci-plugin-test',
      '@datadog/datadog-ci-plugin-another',
      '@datadog/datadog-ci-plugin-synthetics',
    ])
  })
})

describe('checkPlugin', () => {
  test('returns false for invalid scope', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const result = await checkPlugin('invalid-scope')
    expect(result).toBe(false)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('This plugin is not listed as a possible peer dependency')
    )
  })

  test('returns true for standalone binary', async () => {
    mockIsStandaloneBinary.mockResolvedValueOnce(true)
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const result = await checkPlugin('test')
    expect(result).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('The plugin is ready to be used! 🔌'))
  })

  test('returns true for valid plugin', async () => {
    const result = await checkPlugin('synthetics')
    expect(result).toBe(true)
  })

  test('prints plugin version when plugin is found without command', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const result = await checkPlugin('synthetics')
    expect(result).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('@datadog/datadog-ci-plugin-synthetics'))
    expect(
      consoleLogSpy.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' && message.includes('@datadog/datadog-ci-plugin-synthetics v5.13.0')
      )
    ).toHaveLength(1)

    consoleLogSpy.mockRestore()
  })
})

describe('executePluginCommand', () => {
  const module = require('@datadog/datadog-ci-plugin-synthetics/commands/run-tests')
  const SyntheticsRunTestsPluginCommand = module.PluginCommand.prototype

  test('executes plugin command successfully', async () => {
    // Mock the plugin command's `execute` method, but not the `@datadog/datadog-ci-base/commands/synthetics/run-tests` one.
    jest.spyOn(SyntheticsRunTestsPluginCommand, 'execute').mockResolvedValue(0)
    const command = createCommand(SyntheticsRunTestsCommand)
    const result = await executePluginCommand(command)
    expect(result).toBe(0)
  })

  test('injects plugin identity into the user agent context during execution', async () => {
    let userAgent = ''
    jest.spyOn(SyntheticsRunTestsPluginCommand, 'execute').mockImplementation(async () => {
      userAgent = getUserAgent()

      return 0
    })

    const command = createCommand(SyntheticsRunTestsCommand)
    const result = await executePluginCommand(command)

    expect(result).toBe(0)
    expect(userAgent).toMatch(/^datadog-ci\/1\.0\.0 \(node .+; os .+; arch .+\) datadog-ci-plugin-synthetics\/.+$/)
  })

  test('prints plugin version once during command execution', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(SyntheticsRunTestsPluginCommand, 'execute').mockResolvedValue(0)

    const command = createCommand(SyntheticsRunTestsCommand)
    const result = await executePluginCommand(command)

    expect(result).toBe(0)
    expect(
      consoleLogSpy.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' && message.includes('@datadog/datadog-ci-plugin-synthetics v5.13.0')
      )
    ).toHaveLength(1)

    consoleLogSpy.mockRestore()
  })
})

describe('installPlugin', () => {
  test('installs plugin successfully', async () => {
    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({installPackage: mockInstallPackage})

    const result = await installPlugin('test')
    expect(result).toBe(true)
    expect(mockInstallPackage).toHaveBeenCalledWith(['@datadog/datadog-ci-plugin-test@1.0.0'], {
      silent: true,
      dev: true,
    })
    expect(mockMessageBox).toHaveBeenCalled()
  })

  test('handles installation failure', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 1,
      stdout: 'installation failed',
      stderr: 'error message',
    })

    mockImportInstallPkg.mockResolvedValue({installPackage: mockInstallPackage})

    const result = await installPlugin('test')
    expect(result).toBe(false)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to install'))
    expect(consoleLogSpy).toHaveBeenCalledWith('Stdout:', 'installation failed')
    expect(consoleLogSpy).toHaveBeenCalledWith('Stderr:', 'error message')
  })

  test('uses version overrides when provided', async () => {
    process.env['PLUGIN_INSTALL_VERSION_OVERRIDE'] = '1.0.2'

    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({installPackage: mockInstallPackage})

    await installPlugin('test')
    expect(mockInstallPackage).toHaveBeenCalledWith(['@datadog/datadog-ci-plugin-test@1.0.2'], {
      silent: true,
      dev: true,
    })

    delete process.env['PLUGIN_INSTALL_VERSION_OVERRIDE']
  })

  test('handles full package name', async () => {
    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({installPackage: mockInstallPackage})

    await installPlugin('@datadog/datadog-ci-plugin-test')
    expect(mockInstallPackage).toHaveBeenCalledWith(['@datadog/datadog-ci-plugin-test@1.0.0'], {
      silent: true,
      dev: true,
    })
  })

  test('handles import failure', async () => {
    mockImportInstallPkg.mockRejectedValue(new Error('Import failed'))

    await expect(installPlugin('test')).rejects.toThrow('Import failed')
  })
})

describe('VERSION_OVERRIDE_REGEX', () => {
  test.each(['1.0.0', '0.0.1', '10.20.30', 'file:./artifacts/@datadog-datadog-ci-base-20.tgz'])(
    'accepts valid value: %s',
    (value) => {
      expect(VERSION_OVERRIDE_REGEX.test(value)).toBe(true)
    }
  )

  test.each([
    'latest',
    '^1.0.0',
    '~1.0.0',
    '>=1.0.0',
    '1.0',
    '1',
    'file:path; rm -rf /',
    'file:path | cat /etc/passwd',
    'file:path & evil',
    '1.0.0; evil',
    '$(evil)',
    '`evil`',
    'file:path with spaces',
    'file:/absolute/path/to/package.tgz',
    'file:../relative/path.tgz',
    'file:..\\relative\\path.tgz',
    'file:./path_with_underscores.tgz',
  ])('rejects invalid value: %s', (value) => {
    expect(VERSION_OVERRIDE_REGEX.test(value)).toBe(false)
  })
})

describe('getTempPath', () => {
  test('returns the path', () => {
    const tempPath = getTempPath(
      '/Users/john.doe/.npm/_npx/abcdef123456/node_modules/.bin:/Users/john.doe/node_modules/.bin',
      false
    )
    expect(tempPath).toBe('/Users/john.doe/.npm/_npx/abcdef123456/node_modules/.bin')
  })

  test('throw if not found', () => {
    expect(() => getTempPath('', false)).toThrow('Failed to find temporary install directory.')
  })

  describe('Windows', () => {
    test('returns the path', () => {
      const tempPath = getTempPath(
        'PATH=C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin;C:\\Users\\john.doe\\node_modules\\.bin',
        true
      )
      expect(tempPath).toBe('C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin')
    })

    test('detect npm/cache/_npx for GitHub Actions Windows CI', () => {
      const tempPath = getTempPath(
        'PATH=C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin;C:\\Users\\john.doe\\node_modules\\.bin',
        true
      )
      expect(tempPath).toBe('C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin')
    })

    test('same number of backslashes in error', () => {
      const tempPath =
        'PATH=C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\npm-cache\\\\\\\\_npx\\\\\\\\abcdef123456\\\\\\\\node_modules\\\\\\\\.bin\\r\\nC:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\node_modules\\\\\\\\.bin'

      expect(() => getTempPath(tempPath, true)).toThrow(
        `Failed to find temporary install directory. Looking for paths matching '\\npm-cache\\_npx\\' in:
 - C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\npm-cache\\\\\\\\_npx\\\\\\\\abcdef123456\\\\\\\\node_modules\\\\\\\\.bin
 - C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\node_modules\\\\\\\\.bin`
      )
    })

    test('throw if not found', () => {
      expect(() => getTempPath('', true)).toThrow('Failed to find temporary install directory.')
    })
  })
})
