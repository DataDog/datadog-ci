import * as fs from 'fs'

import * as glob from 'glob'

import {globSync} from './fs'
import {buildPath, isFile} from './utils'

const DEFAULT_IGNORED_FOLDERS = [
  '.circleci',
  '.egg-info*',
  '.env',
  '.envs',
  '.git',
  '.github',
  '.gitlab',
  '.go',
  '.gradle',
  '.hg',
  '.idea',
  '.map',
  '.marker',
  '.npm',
  '.nyc_output',
  '.tox',
  '.venv',
  '.venvs',
  '.virtualenv',
  '.virtualenvs',
  '.vscode',
  '.yarn',
  '.yarn-cache',
  '__pycache__',
  'bower_components',
  'conftest_*.c.gcov',
  'htmlcov',
  'js/generated/coverage',
  'jspm_packages',
  'node_modules',
  'virtualenv',
  'virtualenvs',
]

/**
 * Finds and validates files based on the provided base paths.
 *
 * This function processes three types of inputs:
 * 1. Regular files - Direct file paths that exist
 * 2. Directories - Recursively searches for matching files in the directory
 * 3. Glob patterns - Uses the pattern to find matching files
 *
 * @param basePaths - Array of paths to search for files. Can include file paths, directory paths, or glob patterns.
 * @param searchRecursively - Whether to do recursive search in the nested folders (also applies to glob pattern matches).
 * @param ignoredPaths - List of paths to ignore
 * @param filterFile - Function to filter matching files. Should return true if a file matches. Is not applied to files specified explicitly.
 * @param validateFile - Function to validate files that matched. Should return undefined if valid, or an error message string if invalid.
 * @param renderInvalidFile - Function called for each invalid file to handle error reporting.
 * @returns Array of unique file paths that passed validation.
 */
export const findFiles = (
  basePaths: string[],
  searchRecursively: boolean,
  ignoredPaths: string[],
  filterFile: (filePath: string) => boolean,
  validateFile: (filePath: string) => string | undefined,
  renderInvalidFile: (filePath: string, errorMessage: string) => void
): string[] => {
  const files = basePaths.flatMap((basePath) => {
    if (isFile(basePath)) {
      // regular file
      return fs.existsSync(basePath) ? [basePath] : []
    } else if (glob.hasMagic(basePath)) {
      // glob pattern
      const globMatches = globSync(basePath, {dotRelative: true})
      if (searchRecursively) {
        return findFiles(globMatches, searchRecursively, ignoredPaths, filterFile, validateFile, renderInvalidFile)
      } else {
        return globMatches.filter(filterFile).filter(isFile)
      }
    } else {
      // folder
      const results: string[] = []
      if (fs.existsSync(basePath)) {
        traverseDirectory(basePath, searchRecursively, ignoredPaths, filterFile, results)
      }

      return results
    }
  })

  const uniqueFiles = [...new Set(files)]

  return uniqueFiles.filter((filePath) => {
    const validationErrorMessage = validateFile(filePath)
    if (validationErrorMessage) {
      renderInvalidFile(filePath, validationErrorMessage)

      return false
    } else {
      return true
    }
  })
}

const traverseDirectory = (
  dir: string,
  searchRecursively: boolean,
  ignoredPaths: string[],
  filterFile: (filePath: string) => boolean,
  results: string[]
) => {
  const entries = fs.readdirSync(dir, {withFileTypes: true})

  for (const entry of entries) {
    const fullPath = buildPath(dir, entry.name)
    if (ignoredPaths.includes(fullPath)) {
      continue
    }

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_FOLDERS.includes(entry.name)) {
        continue
      }

      if (searchRecursively) {
        traverseDirectory(fullPath, searchRecursively, ignoredPaths, filterFile, results)
      }
    } else if (entry.isFile() && filterFile(fullPath)) {
      results.push(fullPath)
    }
  }
}
