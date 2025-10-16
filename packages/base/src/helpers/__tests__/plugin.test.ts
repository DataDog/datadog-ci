import {getTempPath} from '../plugin'

describe('getTempPath', () => {
  test('returns the path', () => {
    const tempPath = getTempPath(
      '/Users/john.doe/.npm/_npx/abcdef123456/node_modules/.bin:/Users/john.doe/node_modules/.bin'
    )
    expect(tempPath).toBe('/Users/john.doe/.npm/_npx/abcdef123456/node_modules/.bin')
  })

  test('throw if not found', () => {
    expect(() => getTempPath('')).toThrow('Failed to find temporary install directory.')
  })

  describe('Windows', () => {
    const originalPlatform = process.platform

    beforeAll(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
        writable: true,
      })
    })

    afterAll(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      })
    })

    test('returns the path', () => {
      const tempPath = getTempPath(
        'PATH=C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin;C:\\Users\\john.doe\\node_modules\\.bin'
      )
      expect(tempPath).toBe('C:\\Users\\john.doe\\npm-cache\\_npx\\abcdef123456\\node_modules\\.bin')
    })

    test('same number of backslashes in error', () => {
      const tempPath =
        'PATH=C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\npm-cache\\\\\\\\_npx\\\\\\\\abcdef123456\\\\\\\\node_modules\\\\\\\\.bin\\r\\nC:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\node_modules\\\\\\\\.bin'

      expect(() => getTempPath(tempPath)).toThrow(
        `Failed to find temporary install directory. Looking for paths matching '\\npm-cache\\_npx\\' in:
 - C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\npm-cache\\\\\\\\_npx\\\\\\\\abcdef123456\\\\\\\\node_modules\\\\\\\\.bin
 - C:\\\\\\\\Users\\\\\\\\john.doe\\\\\\\\node_modules\\\\\\\\.bin`
      )
    })

    test('throw if not found', () => {
      expect(() => getTempPath('')).toThrow('Failed to find temporary install directory.')
    })
  })
})
