import {isRunViaNpx, getTempPath} from '../npx'

describe('isRunViaNpx', () => {
  const originalArgv = process.argv

  afterEach(() => {
    process.argv = originalArgv
  })

  test('returns true for Unix npx path', () => {
    process.argv = ['node', '/Users/john/.npm/_npx/abc123/node_modules/.bin/datadog-ci']
    expect(isRunViaNpx()).toBe(true)
  })

  test('returns true for Windows npx path', () => {
    process.argv = ['node', 'C:\\Users\\john\\npm-cache\\_npx\\abc123\\node_modules\\.bin\\datadog-ci']
    expect(isRunViaNpx()).toBe(true)
  })

  test('returns false for global install', () => {
    process.argv = ['node', '/usr/local/bin/datadog-ci']
    expect(isRunViaNpx()).toBe(false)
  })

  test('returns false for local node_modules', () => {
    process.argv = ['node', '/project/node_modules/.bin/datadog-ci']
    expect(isRunViaNpx()).toBe(false)
  })

  test('returns false when argv[1] is undefined', () => {
    process.argv = ['node']
    expect(isRunViaNpx()).toBe(false)
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
