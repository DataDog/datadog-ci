import fsPromises from 'fs/promises'

import {generateFileFixes} from '../file-fixes'
import {FileFixes} from '../interfaces'

jest.mock('fs/promises')

const mockGit = {
  raw: jest.fn(),
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

const mockStat = (size: number) => mockFsPromises.stat.mockResolvedValue({size} as any)
const mockStatSequence = (sizes: number[]) => {
  for (const size of sizes) {
    mockFsPromises.stat.mockResolvedValueOnce({size} as any)
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

      mockStat(100)
      mockReadFile('package main\n')

      await generateFileFixes(mockGit)

      // README.md and script.py should not be processed
      expect(mockFsPromises.stat).toHaveBeenCalledTimes(3) // main.go, app.kt, lib.swift
    })

    it('skips files larger than 1MB', async () => {
      mockGit.raw.mockResolvedValue('large.go\nsmall.go\n')

      mockStatSequence([
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

      mockFsPromises.stat.mockRejectedValue(new Error('ENOENT'))

      const result = await generateFileFixes(mockGit)

      expect(result).toEqual({})
    })
  })

  describe('bitmap format', () => {
    it('returns entries with lines count and base64 bitmap', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
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
      mockStat(100)
      mockReadFile('package main\n\n  \nfunc main() {\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 2)).toBe(true) // empty line
      expect(hasLine(result, 'main.go', 3)).toBe(true) // whitespace-only line
    })

    it('detects comment lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('// This is a comment\n  // indented comment\ncode here\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
      expect(hasLine(result, 'main.go', 2)).toBe(true)
      expect(hasLine(result, 'main.go', 3)).toBe(false)
    })

    it('detects block comment delimiters and body', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('/*\n * comment body\n */\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // /*
      expect(hasLine(result, 'main.go', 2)).toBe(true) // comment body
      expect(hasLine(result, 'main.go', 3)).toBe(true) // */
    })

    it('detects single-line block comments', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('/* single line comment */\ncode here\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
      expect(hasLine(result, 'main.go', 2)).toBe(false)
    })

    it('does not mark lines with code before block comment', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('code() /* inline comment */\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('detects bracket-only lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('func main() {\nfmt.Println("hi")\n}\n')

      const result = await generateFileFixes(mockGit)

      // Line 1 has code + bracket, not a bracket-only line
      expect(hasLine(result, 'main.go', 1)).toBe(false)
      expect(hasLine(result, 'main.go', 3)).toBe(true) // closing bracket
    })

    it('detects bracket lines with trailing comments', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('} // end func\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects parenthesis-only lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('(\na = 1\n)')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // (
      expect(hasLine(result, 'main.go', 3)).toBe(true) // )
    })

    it('detects go func lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('func {\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects list regex lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('[][]\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects LCOV_EXCL comments with // style', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('realCode() // LCOV_EXCL_LINE\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('detects LCOV_EXCL comments with /* */ style', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockStat(100)
      mockReadFile('realCode() /* LCOV_EXCL_LINE */\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })
  })

  describe('Kotlin patterns', () => {
    it('detects standard patterns for .kt files', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockStat(100)
      mockReadFile('// comment\n\n{\n}\ncode')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['App.kt'])).toEqual([1, 2, 3, 4])
    })

    it('detects standard patterns for .kts files', async () => {
      mockGit.raw.mockResolvedValue('build.gradle.kts\n')
      mockStat(100)
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
        mockStat(100)
        mockReadFile('// comment\n\n{\n}\n(\n)\ncode')

        const result = await generateFileFixes(mockGit)

        expect(getMatchedLines(result[fileName])).toEqual([1, 2, 3, 4, 5, 6])
      })
    }
  })

  describe('PHP patterns', () => {
    it('detects standard patterns and php_end_bracket for .php files', async () => {
      mockGit.raw.mockResolvedValue('index.php\n')
      mockStat(100)
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
      mockStat(100)
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

      mockStat(100)
      const lines = Array.from({length: 200}, () => '// comment').join('\n')
      mockReadFile(lines)

      const result = await generateFileFixes(mockGit)

      // Should have fewer entries than total files due to size cap
      const entryCount = Object.keys(result).length
      expect(entryCount).toBeGreaterThan(0)
      expect(entryCount).toBeLessThan(9000)
    })
  })
})
