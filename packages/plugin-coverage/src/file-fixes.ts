// File fixes identifies lines that are not executable (comments, blank lines, brackets, etc.)
// so the backend can exclude them from code coverage calculations, reducing false negatives.
// Each file's result is a bitmap where bit i (0-indexed) represents line i+1 (1-indexed).

import fsPromises from 'fs/promises'

import * as simpleGit from 'simple-git'

import {FileFixes} from './interfaces'

const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const MAX_FILES = 100_000
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

const EMPTY_LINE = /^\s*$/
const COMMENT_LINE = /^\s*\/\/.*$/
const BRACKET_LINE = /^\s*[{}]\s*(\/\/.*)?$/
const PARENTHESIS_LINE = /^\s*[()]\s*(\/\/.*)?$/
const LCOV_EXCL = /LCOV_EXCL/

const BLOCK_COMMENT_OPEN = /^\s*\/\*/
const BLOCK_COMMENT_CLOSE = /\*\//

const GO_FUNC_LINE = /^\s*func\s*\{\s*(\/\/.*)?$/
const PHP_END_BRACKET = /^\s*\);\s*(\/\/.*)?$/
// Matches Go empty composite literal type declarations like [][]
const LIST_REGEX = /^\s*\[\]\[\]\s*(\/\/.*)?$/

const BASE_PATTERNS = [EMPTY_LINE, COMMENT_LINE, BRACKET_LINE, PARENTHESIS_LINE, LCOV_EXCL]

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

const processFileContent = (
  filePath: string,
  content: string
): {path: string; totalLines: number; bitmap: Buffer} | undefined => {
  const patterns = getPatternsForFile(filePath)
  if (!patterns) {
    return undefined
  }

  const lines = content.split('\n')
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
      // Check if the block comment also closes on this line
      const afterOpen = line.indexOf('/*') + 2
      if (!line.slice(afterOpen).includes('*/')) {
        insideBlockComment = true
      }
    } else {
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

const processFileAsync = async (
  filePath: string
): Promise<{path: string; totalLines: number; bitmap: Buffer} | undefined> => {
  try {
    const stat = await fsPromises.stat(filePath)
    if (stat.size > MAX_FILE_SIZE) {
      return undefined
    }
  } catch {
    return undefined
  }

  const content = await fsPromises.readFile(filePath, 'utf8')

  return processFileContent(filePath, content)
}

export const generateFileFixes = async (git: simpleGit.SimpleGit): Promise<FileFixes> => {
  const output = await git.raw(['ls-files'])
  const allFiles = output
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0)

  const supportedFiles = allFiles.filter(isSupportedFile)

  if (supportedFiles.length > MAX_FILES) {
    throw new Error(`repository has ${supportedFiles.length} supported files, exceeding the ${MAX_FILES} file limit`)
  }

  // Process files concurrently with bounded parallelism
  const results = await processFilesConcurrently(supportedFiles)

  const fileFixes: FileFixes = {}
  let estimatedSize = 2 // {}

  for (const result of results) {
    const base64 = result.bitmap.toString('base64')
    // Rough estimate: "path": {"lines": N, "bitmap": "base64..."},
    const entrySize = result.path.length + 30 + base64.length
    if (estimatedSize + entrySize > MAX_OUTPUT_SIZE) {
      break
    }
    fileFixes[result.path] = {lines: result.totalLines, bitmap: base64}
    estimatedSize += entrySize
  }

  return fileFixes
}

const processFilesConcurrently = async (
  filePaths: string[]
): Promise<{path: string; totalLines: number; bitmap: Buffer}[]> => {
  const results: {path: string; totalLines: number; bitmap: Buffer}[] = []
  let index = 0

  const worker = async () => {
    while (index < filePaths.length) {
      const i = index++
      const result = await processFileAsync(filePaths[i])
      if (result) {
        results.push(result)
      }
    }
  }

  const workers = Array.from({length: CONCURRENCY}, () => worker())
  await Promise.all(workers)

  return results
}
