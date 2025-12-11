import {isStandaloneBinary} from '../is-standalone-binary'
import {messageBox} from '../message-box'
import * as pluginModule from '../plugin'
import {checkPlugin, executePluginCommand, getTempPath, installPlugin, listAllPlugins} from '../plugin'

jest.mock('node:child_process')
jest.mock('../is-standalone-binary')
jest.mock('../message-box')
jest.mock('../../version', () => ({
  cliVersion: '1.0.0',
}))
jest.mock('@datadog/datadog-ci-base/package.json', () => ({
  peerDependencies: {
    '@datadog/datadog-ci-plugin-test': '^1.0.0',
    '@datadog/datadog-ci-plugin-another': '^2.0.0',
  },
}))

const mockIsStandaloneBinary = isStandaloneBinary as jest.MockedFunction<typeof isStandaloneBinary>
const mockMessageBox = messageBox as jest.MockedFunction<typeof messageBox>
const mockImportInstallPkg = jest.spyOn(pluginModule, 'importInstallPkg')

describe('listAllPlugins', () => {
  test('returns array of peer dependency keys', () => {
    const plugins = listAllPlugins()
    expect(plugins).toEqual(['@datadog/datadog-ci-plugin-test', '@datadog/datadog-ci-plugin-another'])
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

    const result = await checkPlugin('test')
    expect(result).toBe(true)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('The plugin is ready to be used! 🔌'))
  })
})

describe('installPlugin', () => {
  test('installs plugin successfully', async () => {
    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({
      installPackage: mockInstallPackage,
    } as any)

    const result = await installPlugin('test')
    expect(result).toBe(true)
    expect(mockInstallPackage).toHaveBeenCalledWith(
      ['@datadog/datadog-ci-base@1.0.0', '@datadog/datadog-ci-plugin-test@1.0.0'],
      {silent: true, dev: true}
    )
    expect(mockMessageBox).toHaveBeenCalled()
  })

  test('handles installation failure', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 1,
      stdout: 'installation failed',
      stderr: 'error message',
    })

    mockImportInstallPkg.mockResolvedValue({
      installPackage: mockInstallPackage,
    } as any)

    const result = await installPlugin('test')
    expect(result).toBe(false)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to install'))
    expect(consoleLogSpy).toHaveBeenCalledWith('Stdout:', 'installation failed')
    expect(consoleLogSpy).toHaveBeenCalledWith('Stderr:', 'error message')
  })

  test('uses version override when provided', async () => {
    process.env['PLUGIN_AUTO_INSTALL_VERSION_OVERRIDE'] = '2.0.0'

    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({
      installPackage: mockInstallPackage,
    } as any)

    await installPlugin('test')
    expect(mockInstallPackage).toHaveBeenCalledWith(
      ['@datadog/datadog-ci-base@2.0.0', '@datadog/datadog-ci-plugin-test@2.0.0'],
      {silent: true, dev: true}
    )

    delete process.env['PLUGIN_AUTO_INSTALL_VERSION_OVERRIDE']
  })

  test('handles full package name', async () => {
    const mockInstallPackage = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
    })

    mockImportInstallPkg.mockResolvedValue({
      installPackage: mockInstallPackage,
    } as any)

    await installPlugin('@datadog/datadog-ci-plugin-test')
    expect(mockInstallPackage).toHaveBeenCalledWith(
      ['@datadog/datadog-ci-base@1.0.0', '@datadog/datadog-ci-plugin-test@1.0.0'],
      {silent: true, dev: true}
    )
  })

  test('handles import failure', async () => {
    mockImportInstallPkg.mockRejectedValue(new Error('Import failed'))

    await expect(installPlugin('test')).rejects.toThrow('Import failed')
  })
})

describe('checkPlugin', () => {
  test('rejects invalid plugin scope', async () => {
    const result = await checkPlugin('invalid-plugin-name')
    expect(result).toBe(false)
  })

  test('accepts valid plugin scope from peer dependencies', async () => {
    mockIsStandaloneBinary.mockResolvedValueOnce(true)
    const result = await checkPlugin('test')
    expect(result).toBe(true)
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
