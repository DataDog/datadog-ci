// File fixes identifies lines that are not executable (comments, blank lines, brackets, etc.)
// so the backend can exclude them from code coverage calculations, reducing false negatives.
// Each file's result is a bitmap where bit i (0-indexed) represents line i+1 (1-indexed).

import fsPromises from 'fs/promises'

import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {findFiles} from '@datadog/datadog-ci-base/helpers/file-finder'
import * as simpleGit from 'simple-git'
import upath from 'upath'

import {FileFixes} from './interfaces'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_FILES = 200_000
const MAX_OUTPUT_SIZE = 20 * 1024 * 1024 // 20MB estimated serialized size
const CONCURRENCY = 8

const SUPPORTED_EXTENSIONS: Record<string, string[]> = {
  go: ['.go'],
  kotlin: ['.kt', '.kts'],
  'c/cpp/swift/objc': ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.m', '.mm', '.swift'],
  php: ['.php'],
}

const ALL_SUPPORTED_EXTENSIONS = Object.values(SUPPORTED_EXTENSIONS).flat()

interface LanguagePatterns {
  extensions: string[]
  patterns: RegExp[]
}

interface FileFixResult {
  path: string
  totalLines: number
  bitmap: Buffer
}

const EMPTY_LINE = /^\s*$/
const COMMENT_LINE = /^\s*\/\/.*$/
const BRACKET_LINE = /^\s*[{}]\s*(\/\/.*)?$/
const PARENTHESIS_LINE = /^\s*[()]\s*(\/\/.*)?$/

const LCOV_EXCL_LINE = /LCOV_EXCL_LINE/
const LCOV_EXCL_START = /LCOV_EXCL_START/
const LCOV_EXCL_STOP = /LCOV_EXCL_STOP/

const BLOCK_COMMENT_OPEN = /^\s*\/\*/
const BLOCK_COMMENT_CLOSE = /\*\//

const GO_FUNC_LINE = /^\s*func\s*\{\s*(\/\/.*)?$/
const PHP_END_BRACKET = /^\s*\);\s*(\/\/.*)?$/
// Matches Go empty composite literal type declarations like [][]
const LIST_REGEX = /^\s*\[\]\[\]\s*(\/\/.*)?$/

const BASE_PATTERNS = [EMPTY_LINE, COMMENT_LINE, BRACKET_LINE, PARENTHESIS_LINE]

const LANGUAGE_PATTERNS: LanguagePatterns[] = [
  {
    extensions: SUPPORTED_EXTENSIONS['go'],
    patterns: [...BASE_PATTERNS, GO_FUNC_LINE, LIST_REGEX],
  },
  {
    extensions: SUPPORTED_EXTENSIONS['kotlin'],
    patterns: [...BASE_PATTERNS],
  },
  {
    extensions: SUPPORTED_EXTENSIONS['c/cpp/swift/objc'],
    patterns: [...BASE_PATTERNS],
  },
  {
    extensions: SUPPORTED_EXTENSIONS['php'],
    patterns: [...BASE_PATTERNS, PHP_END_BRACKET],
  },
]

/* eslint-disable no-bitwise */
const setBit = (bitmap: Buffer, index: number): void => {
  bitmap[Math.floor(index / 8)] |= 1 << index % 8
}
/* eslint-enable no-bitwise */

const getExtension = (filePath: string): string => {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) {
    return ''
  }

  return filePath.slice(lastDot).toLowerCase()
}

const getPatternsForFile = (filePath: string): RegExp[] | undefined => {
  const ext = getExtension(filePath)
  for (const lang of LANGUAGE_PATTERNS) {
    if (lang.extensions.includes(ext)) {
      return lang.patterns
    }
  }

  return undefined
}

const isSupportedFile = (filePath: string): boolean => {
  const ext = getExtension(filePath)

  return ALL_SUPPORTED_EXTENSIONS.includes(ext)
}

const processFileContent = (filePath: string, content: string): FileFixResult | undefined => {
  const patterns = getPatternsForFile(filePath)
  if (!patterns) {
    return undefined
  }

  const lines = content.split('\n')
  const bitmapSize = Math.ceil(lines.length / 8)
  const bitmap = Buffer.alloc(bitmapSize)
  let hasMatch = false
  let insideBlockComment = false
  let insideLcovExcl = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let matched = false

    // LCOV_EXCL range tracking (highest priority)
    if (insideLcovExcl) {
      matched = true
      if (LCOV_EXCL_STOP.test(line)) {
        insideLcovExcl = false
      }
    } else if (LCOV_EXCL_START.test(line)) {
      matched = true
      insideLcovExcl = true
    } else if (LCOV_EXCL_LINE.test(line)) {
      matched = true
    }

    // Block comment state tracking (always track state, even when LCOV matched)
    if (insideBlockComment) {
      matched = true
      if (BLOCK_COMMENT_CLOSE.test(line)) {
        insideBlockComment = false
      }
    } else {
      const commentIdx = line.indexOf('/*')
      if (commentIdx !== -1) {
        // Mark as non-executable only if /* is at the start of the line
        if (BLOCK_COMMENT_OPEN.test(line)) {
          matched = true
        }
        // Enter block comment state if comment doesn't close on this line
        if (!line.slice(commentIdx + 2).includes('*/')) {
          insideBlockComment = true
        }
      }
    }

    // Regular pattern matching (only if not already matched)
    if (!matched) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          matched = true
          break
        }
      }
    }

    if (matched) {
      setBit(bitmap, i)
      hasMatch = true
    }
  }

  if (!hasMatch) {
    return undefined
  }

  return {path: filePath, totalLines: lines.length, bitmap}
}

const processFileAsync = async (filePath: string, repoRoot: string): Promise<FileFixResult | undefined> => {
  const absolutePath = upath.resolve(repoRoot, filePath)

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
      return undefined
    }

    const content = await fsPromises.readFile(absolutePath, 'utf8')

    return processFileContent(filePath, content)
  } catch {
    return undefined
  }
}

const listFilesFromFilesystem = (rootPath: string): string[] => {
  const absolutePaths = findFiles(
    [rootPath],
    true, // searchRecursively
    [], // ignoredPaths (DEFAULT_IGNORED_FOLDERS is applied internally)
    (filePath) => isSupportedFile(filePath),
    () => undefined, // no validation
    () => undefined // no error rendering
  )

  return absolutePaths.map((absPath) => upath.relative(rootPath, absPath))
}

const collectResults = (results: FileFixResult[]): FileFixes => {
  const fileFixes: FileFixes = {}
  let estimatedSize = 2 // {}

  for (const result of results) {
    const base64 = result.bitmap.toString('base64')
    const entrySize = result.path.length + base64.length
    if (estimatedSize + entrySize > MAX_OUTPUT_SIZE) {
      break
    }
    fileFixes[result.path] = {lines: result.totalLines, bitmap: base64}
    estimatedSize += entrySize
  }

  return fileFixes
}

export const generateFileFixes = async (
  git: simpleGit.SimpleGit | undefined,
  searchPath?: string
): Promise<FileFixes> => {
  let repoRoot: string
  let supportedFiles: string[]

  if (searchPath) {
    // Explicit search path overrides everything
    repoRoot = upath.resolve(searchPath)
  } else if (git) {
    repoRoot = (await git.revparse(['--show-toplevel'])).trim()
  } else {
    repoRoot = process.cwd()
  }

  if (git && !searchPath) {
    // Use git ls-files for tracked files (respects .gitignore)
    const output = await git.raw(['ls-files'])
    const allFiles = output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
    supportedFiles = allFiles.filter(isSupportedFile)
  } else {
    // Filesystem walk fallback (when git is not available or search path is overridden)
    supportedFiles = listFilesFromFilesystem(repoRoot)
  }

  if (supportedFiles.length > MAX_FILES) {
    throw new Error(`repository has ${supportedFiles.length} supported files, exceeding the ${MAX_FILES} file limit`)
  }

  // Process files concurrently with bounded parallelism
  const allResults = await doWithMaxConcurrency(CONCURRENCY, supportedFiles, (filePath) =>
    processFileAsync(filePath, repoRoot)
  )
  const results = allResults.filter((r): r is FileFixResult => r !== undefined)

  return collectResults(results)
}
