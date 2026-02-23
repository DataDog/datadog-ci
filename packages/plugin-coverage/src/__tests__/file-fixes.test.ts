import fsPromises from 'fs/promises'

import {findFiles} from '@datadog/datadog-ci-base/helpers/file-finder'

import {generateFileFixes} from '../file-fixes'
import {FileFixes} from '../interfaces'

jest.mock('fs/promises')
jest.mock('@datadog/datadog-ci-base/helpers/file-finder')

const mockGit = {
  raw: jest.fn(),
  revparse: jest.fn().mockResolvedValue('/repo'),
} as any

// Decode a bitmap entry back to 1-indexed line numbers for easier assertions
const getMatchedLines = (entry: {lines: number; bitmap: string}): number[] => {
  const buf = Buffer.from(entry.bitmap, 'base64')
  const result: number[] = []
  for (let i = 0; i < entry.lines; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitOffset = i % 8
    // eslint-disable-next-line no-bitwise
    if (buf[byteIndex] & (1 << bitOffset)) {
      result.push(i + 1)
    }
  }

  return result
}

const hasLine = (fileFixes: FileFixes, file: string, line: number): boolean => {
  const entry = fileFixes[file]
  if (!entry) {
    return false
  }
  const buf = Buffer.from(entry.bitmap, 'base64')
  const bitIndex = line - 1
  const byteIndex = Math.floor(bitIndex / 8)
  const bitOffset = bitIndex % 8

  // eslint-disable-next-line no-bitwise
  return (buf[byteIndex] & (1 << bitOffset)) !== 0
}

const mockFsPromises = jest.mocked(fsPromises)

const mockLstat = (size: number) => mockFsPromises.lstat.mockResolvedValue({size, isFile: () => true} as any)
const mockLstatSequence = (sizes: number[]) => {
  for (const size of sizes) {
    mockFsPromises.lstat.mockResolvedValueOnce({size, isFile: () => true} as any)
  }
}
const mockReadFile = (content: string) => mockFsPromises.readFile.mockResolvedValue(content as any)

describe('generateFileFixes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('file filtering', () => {
    it('only processes files with supported extensions', async () => {
      mockGit.raw.mockResolvedValue('main.go\nREADME.md\napp.kt\nscript.py\nlib.swift\n')

      mockLstat(100)
      mockReadFile('package main\n')

      await generateFileFixes(mockGit)

      // README.md and script.py should not be processed
      expect(mockFsPromises.lstat).toHaveBeenCalledTimes(3) // main.go, app.kt, lib.swift
    })

    it('skips files larger than 1MB', async () => {
      mockGit.raw.mockResolvedValue('large.go\nsmall.go\n')

      mockLstatSequence([
        1024 * 1024 + 1, // large.go exceeds limit
        100, // small.go is fine
      ])

      mockReadFile('// comment')

      const result = await generateFileFixes(mockGit)

      expect(mockFsPromises.readFile).toHaveBeenCalledTimes(1) // only small.go
      expect(result).toHaveProperty(['small.go'])
      expect(result).not.toHaveProperty(['large.go'])
    })

    it('skips files that do not exist', async () => {
      mockGit.raw.mockResolvedValue('missing.go\n')

      mockFsPromises.lstat.mockRejectedValue(new Error('ENOENT'))

      const result = await generateFileFixes(mockGit)

      expect(result).toEqual({})
    })

    it('skips symlinks', async () => {
      mockGit.raw.mockResolvedValue('link.go\n')

      mockFsPromises.lstat.mockResolvedValue({size: 100, isFile: () => false} as any)

      const result = await generateFileFixes(mockGit)

      expect(mockFsPromises.readFile).not.toHaveBeenCalled()
      expect(result).toEqual({})
    })

    it('skips files that fail to read', async () => {
      mockGit.raw.mockResolvedValue('unreadable.go\n')

      mockFsPromises.lstat.mockResolvedValue({size: 100, isFile: () => true} as any)
      mockFsPromises.readFile.mockRejectedValue(new Error('EACCES'))

      const result = await generateFileFixes(mockGit)

      expect(result).toEqual({})
    })
  })

  describe('bitmap format', () => {
    it('returns entries with lines count and base64 bitmap', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('// comment\ncode\n')

      const result = await generateFileFixes(mockGit)

      expect(result['main.go']).toHaveProperty('lines')
      expect(result['main.go']).toHaveProperty('bitmap')
      expect(typeof result['main.go'].lines).toBe('number')
      expect(typeof result['main.go'].bitmap).toBe('string')
    })
  })

  describe('Go patterns', () => {
    it('detects empty lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('package main\n\n  \nfunc main() {\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 2)).toBe(true) // empty line
      expect(hasLine(result, 'main.go', 3)).toBe(true) // whitespace-only line
    })

    it('detects comment lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('// This is a comment\n  // indented comment\ncode here\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
      expect(hasLine(result, 'main.go', 2)).toBe(true)
      expect(hasLine(result, 'main.go', 3)).toBe(false)
    })

    it('detects block comment delimiters and body', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('/*\n * comment body\n */\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // /*
      expect(hasLine(result, 'main.go', 2)).toBe(true) // comment body
      expect(hasLine(result, 'main.go', 3)).toBe(true) // */
    })

    it('detects single-line block comments', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('/* single line comment */\ncode here\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
      expect(hasLine(result, 'main.go', 2)).toBe(false)
    })

    it('does not mark lines with code before block comment', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code() /* inline comment */\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('detects bracket-only lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func main() {\nfmt.Println("hi")\n}\n')

      const result = await generateFileFixes(mockGit)

      // Line 1 has code + bracket, not a bracket-only line
      expect(hasLine(result, 'main.go', 1)).toBe(false)
      expect(hasLine(result, 'main.go', 3)).toBe(true) // closing bracket
    })

    it('detects bracket lines with trailing comments', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('} // end func\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects parenthesis-only lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('(\na = 1\n)')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // (
      expect(hasLine(result, 'main.go', 3)).toBe(true) // )
    })

    it('detects go func lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func {\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects list regex lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('[][]\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects LCOV_EXCL comments with // style', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('realCode() // LCOV_EXCL_LINE\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects LCOV_EXCL comments with /* */ style', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('realCode() /* LCOV_EXCL_LINE */\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('marks all lines between LCOV_EXCL_START and LCOV_EXCL_STOP', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code()\n// LCOV_EXCL_START\nuntested()\nanother()\n// LCOV_EXCL_STOP\nmore_code()')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(false) // code before START
      expect(hasLine(result, 'main.go', 2)).toBe(true) // LCOV_EXCL_START line
      expect(hasLine(result, 'main.go', 3)).toBe(true) // inside exclusion range
      expect(hasLine(result, 'main.go', 4)).toBe(true) // inside exclusion range
      expect(hasLine(result, 'main.go', 5)).toBe(true) // LCOV_EXCL_STOP line
      expect(hasLine(result, 'main.go', 6)).toBe(false) // code after STOP
    })

    it('marks lines inside block comment opened mid-line', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code() /*\n comment body\n*/\nmore_code()')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(false) // code before /* (has executable code)
      expect(hasLine(result, 'main.go', 2)).toBe(true) // inside block comment
      expect(hasLine(result, 'main.go', 3)).toBe(true) // closing */
      expect(hasLine(result, 'main.go', 4)).toBe(false) // code after block comment
    })
  })

  describe('Kotlin patterns', () => {
    it('detects standard patterns for .kt files', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockLstat(100)
      mockReadFile('// comment\n\n{\n}\ncode')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['App.kt'])).toEqual([1, 2, 3, 4])
    })

    it('detects standard patterns for .kts files', async () => {
      mockGit.raw.mockResolvedValue('build.gradle.kts\n')
      mockLstat(100)
      mockReadFile('// comment\ncode')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['build.gradle.kts'])).toEqual([1])
    })
  })

  describe('C/C++/Swift/ObjC patterns', () => {
    const extensions = ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.m', '.mm', '.swift']

    for (const ext of extensions) {
      it(`detects patterns for ${ext} files`, async () => {
        const fileName = `file${ext}`
        mockGit.raw.mockResolvedValue(`${fileName}\n`)
        mockLstat(100)
        mockReadFile('// comment\n\n{\n}\n(\n)\ncode')

        const result = await generateFileFixes(mockGit)

        expect(getMatchedLines(result[fileName])).toEqual([1, 2, 3, 4, 5, 6])
      })
    }
  })

  describe('PHP patterns', () => {
    it('detects standard patterns and php_end_bracket for .php files', async () => {
      mockGit.raw.mockResolvedValue('index.php\n')
      mockLstat(100)
      mockReadFile('// comment\n);\n  ); // trailing\ncode\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'index.php', 1)).toBe(true) // comment
      expect(hasLine(result, 'index.php', 2)).toBe(true) // );
      expect(hasLine(result, 'index.php', 3)).toBe(true) // ); with trailing comment
      expect(hasLine(result, 'index.php', 4)).toBe(false) // code
    })
  })

  describe('no matches', () => {
    it('does not include files with no matching lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('package main\nfunc main() { fmt.Println("hello") }\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })
  })

  describe('empty repo', () => {
    it('returns empty object when no files', async () => {
      mockGit.raw.mockResolvedValue('\n')

      const result = await generateFileFixes(mockGit)

      expect(result).toEqual({})
    })
  })

  describe('safety limits', () => {
    it('throws when supported file count exceeds 100000', async () => {
      const files = Array.from({length: 100_001}, (_, i) => `file${i}.go`).join('\n')
      mockGit.raw.mockResolvedValue(files)

      await expect(generateFileFixes(mockGit)).rejects.toThrow('exceeding the 100000 file limit')
    })

    it('stops accumulating when estimated output size exceeds limit', async () => {
      // Use long paths to inflate per-entry size and hit the 20MB limit
      const longPrefix = 'a'.repeat(4000)
      const files = Array.from({length: 9000}, (_, i) => `${longPrefix}/file${i}.go`).join('\n')
      mockGit.raw.mockResolvedValue(files)

      mockLstat(100)
      const lines = Array.from({length: 200}, () => '// comment').join('\n')
      mockReadFile(lines)

      const result = await generateFileFixes(mockGit)

      // Should have fewer entries than total files due to size cap
      const entryCount = Object.keys(result).length
      expect(entryCount).toBeGreaterThan(0)
      expect(entryCount).toBeLessThan(9000)
    })
  })

  describe('filesystem fallback (no git)', () => {
    const mockFindFiles = jest.mocked(findFiles)

    it('walks filesystem when git is undefined', async () => {
      mockFindFiles.mockReturnValue(['/workspace/main.go'])
      mockLstat(100)
      mockReadFile('// comment\ncode\n')

      const result = await generateFileFixes(undefined, '/workspace')

      expect(mockGit.raw).not.toHaveBeenCalled()
      expect(mockFindFiles).toHaveBeenCalledWith(
        ['/workspace'],
        true,
        [],
        expect.any(Function),
        expect.any(Function),
        expect.any(Function)
      )
      expect(result).toHaveProperty(['main.go'])
    })

    it('returns relative paths from search root', async () => {
      mockFindFiles.mockReturnValue(['/workspace/src/app.go'])
      mockLstat(100)
      mockReadFile('// comment\n')

      const result = await generateFileFixes(undefined, '/workspace')

      expect(result).toHaveProperty(['src/app.go'])
    })

    it('filters by supported extensions via findFiles callback', async () => {
      mockFindFiles.mockReturnValue([])

      await generateFileFixes(undefined, '/workspace')

      // Verify the filter callback is passed and works correctly
      const filterFn = mockFindFiles.mock.calls[0][3]
      expect(filterFn('/workspace/main.go')).toBe(true)
      expect(filterFn('/workspace/README.md')).toBe(false)
      expect(filterFn('/workspace/app.kt')).toBe(true)
      expect(filterFn('/workspace/script.py')).toBe(false)
    })

    it('uses search path override even when git is available', async () => {
      mockFindFiles.mockReturnValue(['/custom/path/lib.go'])
      mockLstat(100)
      mockReadFile('// comment\n')

      const result = await generateFileFixes(mockGit, '/custom/path')

      // Should NOT call git ls-files when search path is provided
      expect(mockGit.raw).not.toHaveBeenCalled()
      expect(result).toHaveProperty(['lib.go'])
    })
  })
})
