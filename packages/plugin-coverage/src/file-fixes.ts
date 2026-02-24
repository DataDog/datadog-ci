// File fixes identifies lines that are not executable (comments, blank lines, brackets, etc.)
// so the backend can exclude them from code coverage calculations, reducing false negatives.
// Each file's result is a bitmap where bit i (0-indexed) represents line i+1 (1-indexed).

import fsPromises from 'fs/promises'

import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {findFiles} from '@datadog/datadog-ci-base/helpers/file-finder'
import {gitTrackedFiles} from '@datadog/datadog-ci-base/helpers/git/get-git-data'
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

const BLOCK_COMMENT_OPEN = /^\s*\/\*/
const BLOCK_COMMENT_CLOSE = /\*\//

const GO_FUNC_LINE = /^\s*func\s+.*\{\s*(\/\/.*)?$/
const PHP_END_BRACKET = /^\s*\);\s*(\/\/.*)?$/

const BASE_PATTERNS = [EMPTY_LINE, COMMENT_LINE, BRACKET_LINE, PARENTHESIS_LINE]

const LANGUAGE_PATTERNS: LanguagePatterns[] = [
  {
    extensions: SUPPORTED_EXTENSIONS['go'],
    patterns: [...BASE_PATTERNS, GO_FUNC_LINE],
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

// Build a map from extension to patterns for O(1) lookup
const EXTENSION_TO_PATTERNS = new Map<string, RegExp[]>()
for (const lang of LANGUAGE_PATTERNS) {
  for (const ext of lang.extensions) {
    EXTENSION_TO_PATTERNS.set(ext, lang.patterns)
  }
}

/* eslint-disable no-bitwise */
const setBit = (bitmap: Buffer, index: number): void => {
  bitmap[Math.floor(index / 8)] |= 1 << index % 8
}
/* eslint-enable no-bitwise */

const getExtension = (filePath: string): string => {
  return upath.extname(filePath).toLowerCase()
}

const getPatternsForFile = (filePath: string): RegExp[] | undefined => {
  return EXTENSION_TO_PATTERNS.get(getExtension(filePath))
}

const isSupportedFile = (filePath: string): boolean => {
  return EXTENSION_TO_PATTERNS.has(getExtension(filePath))
}

const processFileContent = (filePath: string, content: string): FileFixResult | undefined => {
  const patterns = getPatternsForFile(filePath)
  if (!patterns) {
    return undefined
  }

  const lines = content.split(/\r\n|\r|\n/)
  // Remove trailing empty element produced by split when file ends with newline
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  const bitmapSize = Math.ceil(lines.length / 8)
  const bitmap = Buffer.alloc(bitmapSize)
  let hasMatch = false
  let insideBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let matched = false

    // Block comment state tracking
    if (insideBlockComment) {
      matched = true
      if (BLOCK_COMMENT_CLOSE.test(line)) {
        insideBlockComment = false
      }
    } else if (BLOCK_COMMENT_OPEN.test(line)) {
      matched = true
      if (!BLOCK_COMMENT_CLOSE.test(line)) {
        insideBlockComment = true
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

  // Verify resolved path stays within the repo root
  if (!absolutePath.startsWith(repoRoot + '/') && absolutePath !== repoRoot) {
    return undefined
  }

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
  let estimatedSize = JSON.stringify(fileFixes).length

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
    repoRoot = upath.resolve((await git.revparse(['--show-toplevel'])).trim())
  } else {
    repoRoot = upath.resolve(process.cwd())
  }

  if (git && !searchPath) {
    // Use git ls-files for tracked files (respects .gitignore)
    const allFiles = await gitTrackedFiles(git)
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
