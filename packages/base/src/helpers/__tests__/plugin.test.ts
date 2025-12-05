import {getTempPath, isNpx} from '../plugin'

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

describe('isNpx', () => {
  test('windows - returns true', () => {
    process.env.PATH =
      'C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin;C:\\Users\\john.doe\\node_modules\\.bin'
    expect(isNpx(true)).toBe(true)
  })

  test('windows - returns false', () => {
    process.env.PATH = 'C:\\Users\\john.doe\\node_modules\\.bin'
    expect(isNpx(true)).toBe(false)
  })

  test('unix - returns true', () => {
    process.env.PATH = '/Users/john.doe/.npm/_npx/abcdef123456/node_modules/.bin:/Users/john.doe/node_modules/.bin'
    expect(isNpx(false)).toBe(true)
  })

  test('unix - returns false', () => {
    process.env.PATH = '/Users/john.doe/node_modules/.bin'
    expect(isNpx(false)).toBe(false)
  })
})
