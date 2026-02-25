import fsPromises from 'fs/promises'

import {findFiles} from '@datadog/datadog-ci-base/helpers/file-finder'
import upath from 'upath'

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

    it('skips files larger than 2MB', async () => {
      mockGit.raw.mockResolvedValue('large.go\nsmall.go\n')

      mockLstatSequence([
        2 * 1024 * 1024 + 1, // large.go exceeds limit
        100, // small.go is fine
      ])

      mockReadFile('}\n')

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

    it('skips files that resolve outside the repo root', async () => {
      mockGit.raw.mockResolvedValue('../../etc/passwd.go\n')

      mockLstat(100)
      mockReadFile('package main\n')

      const result = await generateFileFixes(mockGit)

      expect(mockFsPromises.lstat).not.toHaveBeenCalled()
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
      mockReadFile('}\ncode\n')

      const result = await generateFileFixes(mockGit)

      expect(result['main.go']).toHaveProperty('lines')
      expect(result['main.go']).toHaveProperty('bitmap')
      expect(typeof result['main.go'].lines).toBe('number')
      expect(typeof result['main.go'].bitmap).toBe('string')
    })
  })

  describe('Go patterns', () => {
    it('detects bracket-only lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func main() {\nfmt.Println("hi")\n}\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // func declaration
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

    it('detects function declaration lines', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func main() {\nfmt.Println("hi")\n}\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // func main() {
      expect(hasLine(result, 'main.go', 2)).toBe(false) // code
      expect(hasLine(result, 'main.go', 3)).toBe(true) // }
    })

    it('detects method receiver function declarations', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func (s *Server) Handle(req Request) error {\nreturn nil\n}\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true)
    })

    it('does not match single-line function with body', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func main() { return 1 }\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('does not match anonymous functions', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('func() {\nreturn\n}\n')

      const result = await generateFileFixes(mockGit)

      // func() { is executable (anonymous function), only } should match
      expect(hasLine(result, 'main.go', 1)).toBe(false)
      expect(hasLine(result, 'main.go', 3)).toBe(true)
    })
  })

  describe('Kotlin patterns', () => {
    it('detects structural patterns for .kt files', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockLstat(100)
      mockReadFile('code\n{\n}\n(\n)\nmore')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['App.kt'])).toEqual([2, 3, 4, 5])
    })

    it('detects structural patterns for .kts files', async () => {
      mockGit.raw.mockResolvedValue('build.gradle.kts\n')
      mockLstat(100)
      mockReadFile('}\ncode')

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
        mockReadFile('code\n{\n}\n(\n)\nmore')

        const result = await generateFileFixes(mockGit)

        expect(getMatchedLines(result[fileName])).toEqual([2, 3, 4, 5])
      })
    }
  })

  describe('PHP patterns', () => {
    it('detects structural patterns and php_end_bracket for .php files', async () => {
      mockGit.raw.mockResolvedValue('index.php\n')
      mockLstat(100)
      mockReadFile('code\n);\n  ); // trailing\n}\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'index.php', 1)).toBe(false) // code
      expect(hasLine(result, 'index.php', 2)).toBe(true) // );
      expect(hasLine(result, 'index.php', 3)).toBe(true) // ); with trailing comment
      expect(hasLine(result, 'index.php', 4)).toBe(true) // }
    })
  })

  describe('block comments', () => {
    it('marks multi-line block comment as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code()\n/*\n  comment line 1\n  comment line 2\n*/\nmore_code()\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(false) // code()
      expect(hasLine(result, 'main.go', 2)).toBe(true) // /*
      expect(hasLine(result, 'main.go', 3)).toBe(true) // comment line 1
      expect(hasLine(result, 'main.go', 4)).toBe(true) // comment line 2
      expect(hasLine(result, 'main.go', 5)).toBe(true) // */
      expect(hasLine(result, 'main.go', 6)).toBe(false) // more_code()
    })

    it('marks single-line block comment as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('/* single line comment */\ncode()\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // /* ... */
      expect(hasLine(result, 'main.go', 2)).toBe(false) // code()
    })

    it('marks block comment close line as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('/*\n comment\n*/\nmore_code()\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // /*
      expect(hasLine(result, 'main.go', 2)).toBe(true) // comment
      expect(hasLine(result, 'main.go', 3)).toBe(true) // */
      expect(hasLine(result, 'main.go', 4)).toBe(false) // more_code()
    })

    it('does not detect /* inside string literals', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile(
        [
          'fmt.Println("/*")', // 1: /* inside string
          '"/*"', // 2: bare string containing /*
          "'/*'", // 3: single-quoted /* (e.g. char literal)
          'code()', // 4: code — proves no block comment was opened
        ].join('\n')
      )

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('marks line comments as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('// this is a comment\ncode()\n  // indented comment\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(true) // // comment
      expect(hasLine(result, 'main.go', 2)).toBe(false) // code()
      expect(hasLine(result, 'main.go', 3)).toBe(true) // indented comment
    })

    it('marks empty lines as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code()\n\n  \nmore_code()\n')

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 1)).toBe(false) // code()
      expect(hasLine(result, 'main.go', 2)).toBe(true) // empty line
      expect(hasLine(result, 'main.go', 3)).toBe(true) // whitespace only
      expect(hasLine(result, 'main.go', 4)).toBe(false) // more_code()
    })
  })

  describe('block comment edge cases', () => {
    it('handles multiple, nested, and doc-style block comments', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile(
        [
          '/* first */', // 1: single-line
          'code()', // 2: code
          '/* second', // 3: open
          '/* nested', // 4: nested /* ignored
          'still inside */', // 5: close at first */
          '/** doc', // 6: doc-style open
          ' * @param x', // 7: inside
          ' */', // 8: close
          'more()', // 9: code
        ].join('\n')
      )

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['main.go'])).toEqual([1, 3, 4, 5, 6, 7, 8])
    })

    it('marks all remaining lines when block comment is never closed', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code()\n/* unclosed\nstill inside\nlast line')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['main.go'])).toEqual([2, 3, 4])
    })

    it('detects block comment open with leading whitespace', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('code()\n\t/* tab-indented\ncomment */\n   /* space-indented */\nmore()\n')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['main.go'])).toEqual([2, 3, 4])
    })

    it('marks other patterns inside block comments via block comment state', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      // }, //, empty line, func decl — all inside block comment
      mockReadFile('code()\n/*\n}\n// line\n\nfunc main() {\n*/\nmore()\n')

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['main.go'])).toEqual([2, 3, 4, 5, 6, 7])
    })

    it('works across all supported language extensions', async () => {
      for (const ext of ['.go', '.kt', '.c', '.cpp', '.swift', '.php', '.h', '.m']) {
        const fileName = `file${ext}`
        mockGit.raw.mockResolvedValue(`${fileName}\n`)
        mockLstat(100)
        mockReadFile('code()\n/*\n comment\n*/\nmore()\n')

        const result = await generateFileFixes(mockGit)

        expect(getMatchedLines(result[fileName])).toEqual([2, 3, 4])
      }
    })
  })

  describe('realistic code patterns', () => {
    it('Go file with doc comment, func, line comments, and brackets', async () => {
      mockGit.raw.mockResolvedValue('mixed.go\n')
      mockLstat(100)
      mockReadFile(
        [
          '// Package server', // 1: line comment
          'package server', // 2: code
          '', // 3: empty
          '/*', // 4: block open
          'Overview of the Server type.', // 5: inside block
          '*/', // 6: block close
          'func NewServer(port int) *Server {', // 7: func decl
          '\ts := &Server{port: port}', // 8: code
          '\t// initialize defaults', // 9: line comment
          '\ts.init()', // 10: code
          '', // 11: empty
          '\treturn s', // 12: code
          '}', // 13: bracket
        ].join('\n')
      )

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['mixed.go'])).toEqual([1, 3, 4, 5, 6, 7, 9, 11, 13])
    })

    it('PHP function with PHPDoc and ); ending', async () => {
      mockGit.raw.mockResolvedValue('routes.php\n')
      mockLstat(100)
      mockReadFile(
        [
          '/**', // 1: block open
          ' * Register routes.', // 2: inside block
          ' */', // 3: block close
          'function registerRoutes($router) {', // 4: code
          '    $router->get("/users", function () {', // 5: code
          '        return User::all();', // 6: code
          '    });', // 7: not matched
          '}', // 8: bracket
          '', // 9: empty
          '$app->register(', // 10: code
          '    new ServiceProvider()', // 11: code
          ');', // 12: );
        ].join('\n')
      )

      const result = await generateFileFixes(mockGit)

      expect(getMatchedLines(result['routes.php'])).toEqual([1, 2, 3, 8, 9, 12])
    })
  })

  describe('false positives', () => {
    it('COMMENT_LINE: does not treat // inside Kotlin multiline string as a comment', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockLstat(100)
      mockReadFile(['val txt = """', '// not a comment', '"""', 'println(txt)'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty(['App.kt'])
    })

    it('BRACKET_LINE: does not treat } inside Kotlin multiline string as structural brace', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockLstat(100)
      mockReadFile(['val txt = """', '}', '"""', 'println(txt)'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty(['App.kt'])
    })

    it('PARENTHESIS_LINE: does not treat ) inside Kotlin multiline string as structural parenthesis', async () => {
      mockGit.raw.mockResolvedValue('App.kt\n')
      mockLstat(100)
      mockReadFile(['val txt = """', ')', '"""', 'println(txt)'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty(['App.kt'])
    })

    it('BLOCK_COMMENT_OPEN/CLOSE: does not treat /* */ inside Go raw string as a block comment', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile(['package main', 'var txt = `', '/*', 'still string', '*/', '`', 'var n = 1'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty(['main.go'])
    })

    it('BLOCK_COMMENT_CLOSE: does not mark a line that closes a block comment and has code', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile(['package main', '/*', 'comment', '*/ var x = 1', 'var y = 2'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 4)).toBe(false)
    })

    it('GO_FUNC_LINE: does not treat anonymous function literal with spacing as declaration line', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile(
        ['package main', 'func main() {', '    func () {', '        println("x")', '    }()', '}'].join('\n')
      )

      const result = await generateFileFixes(mockGit)

      expect(hasLine(result, 'main.go', 3)).toBe(false)
    })

    it('PHP_END_BRACKET: does not treat ); inside heredoc body as executable-structure line', async () => {
      mockGit.raw.mockResolvedValue('index.php\n')
      mockLstat(100)
      mockReadFile(['<?php', '$sql = <<<SQL', ');', 'SQL;', 'echo $sql;'].join('\n'))

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty(['index.php'])
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

    it('does not emit phantom line from trailing newline', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      // File with only executable lines ending in newline — split('\n') would
      // produce a trailing empty string that could inflate the line count
      mockReadFile('package main\nvar x = 1\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('does not mark lines with code as non-executable', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('x := doWork()\nfmt.Println(x)\nreturn x\n')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('handles empty file content', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('')

      const result = await generateFileFixes(mockGit)

      expect(result).not.toHaveProperty('main.go')
    })

    it('handles file with only a newline', async () => {
      mockGit.raw.mockResolvedValue('main.go\n')
      mockLstat(100)
      mockReadFile('\n')

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
    it('throws when supported file count exceeds 200000', async () => {
      const files = Array.from({length: 200_001}, (_, i) => `file${i}.go`).join('\n')
      mockGit.raw.mockResolvedValue(files)

      await expect(generateFileFixes(mockGit)).rejects.toThrow('exceeding the 200000 file limit')
    })

    it('stops accumulating when estimated output size exceeds limit', async () => {
      // Use long paths to inflate per-entry size and hit the 20MB limit
      const longPrefix = 'a'.repeat(4000)
      const files = Array.from({length: 9000}, (_, i) => `${longPrefix}/file${i}.go`).join('\n')
      mockGit.raw.mockResolvedValue(files)

      mockLstat(100)
      const lines = Array.from({length: 200}, () => '}').join('\n')
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
      const resolvedRoot = upath.resolve('/workspace')
      mockFindFiles.mockReturnValue([upath.join(resolvedRoot, 'main.go')])
      mockLstat(100)
      mockReadFile('}\ncode\n')

      const result = await generateFileFixes(undefined, '/workspace')

      expect(mockGit.raw).not.toHaveBeenCalled()
      expect(mockFindFiles).toHaveBeenCalledWith(
        [resolvedRoot],
        true,
        [],
        expect.any(Function),
        expect.any(Function),
        expect.any(Function)
      )
      expect(result).toHaveProperty(['main.go'])
    })

    it('returns relative paths from search root', async () => {
      const resolvedRoot = upath.resolve('/workspace')
      mockFindFiles.mockReturnValue([upath.join(resolvedRoot, 'src/app.go')])
      mockLstat(100)
      mockReadFile('}\n')

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
      const resolvedRoot = upath.resolve('/custom/path')
      mockFindFiles.mockReturnValue([upath.join(resolvedRoot, 'lib.go')])
      mockLstat(100)
      mockReadFile('}\n')

      const result = await generateFileFixes(mockGit, '/custom/path')

      // Should NOT call git ls-files when search path is provided
      expect(mockGit.raw).not.toHaveBeenCalled()
      expect(result).toHaveProperty(['lib.go'])
    })
  })
})
