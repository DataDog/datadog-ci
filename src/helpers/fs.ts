/**
 * @file Functions that interact with the file system.
 * Functions have built-in error handling for more descriptive error messages.
 */

import fs from 'fs'
import path from 'path'

import * as globModule from 'glob'
import JSZip from 'jszip'

const GLOB_DEFAULT_OPTIONS: globModule.GlobOptionsWithFileTypesFalse = {
  // For backwards compatibility, use POSIX style paths even on Windows.
  posix: true,
}

/**
 * Synchronous form of `glob`, with default options.
 */
export const globSync = (pattern: string, opts?: globModule.GlobOptionsWithFileTypesFalse) => {
  return globModule.sync(pattern, {...GLOB_DEFAULT_OPTIONS, ...opts})
}

/**
 * Asynchronous form of `glob`, with default options.
 */
export const globAsync = (pattern: string, opts?: globModule.GlobOptionsWithFileTypesFalse) => {
  return globModule.glob(pattern, {...GLOB_DEFAULT_OPTIONS, ...opts})
}

/**
 * Delete a folder and all its contents
 * @param folderPath the folder to delete
 * @throws Error if the deletion fails
 */
export const deleteFolder = (folderPath: string) => {
  try {
    fs.rmSync(folderPath, {recursive: true, force: true})
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Failed to delete files located at ${folderPath}: ${err.message}`)
    }
  }
}

/**
 * Write the data to a file
 * @param filePath path to the file
 * @param data the data to write
 * @throws Error if the file cannot be written
 */
export const writeFile = (filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data)
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to write file: ${err.message}`)
    }
  }
}

/**
 * Zip the entire contents of a folder
 * @param rootFolderPath path to the root folder to zip
 * @param zipPath path to save the zip file
 * @throws Error if the zip fails
 */
export const zipContents = async (rootFolderPath: string, zipPath: string) => {
  const zip = new JSZip()

  const addFolderToZip = (folderPath: string) => {
    if (!fs.existsSync(folderPath)) {
      throw Error(`Folder does not exist: ${folderPath}`)
    }

    const folder = fs.statSync(folderPath)
    if (!folder.isDirectory()) {
      throw Error(`Path is not a directory: ${folderPath}`)
    }

    const contents = fs.readdirSync(folderPath)
    for (const item of contents) {
      const fullPath = path.join(folderPath, item)
      const file = fs.statSync(fullPath)

      if (file.isDirectory()) {
        addFolderToZip(fullPath)
      } else {
        const data = fs.readFileSync(fullPath)
        zip.file(path.relative(rootFolderPath, fullPath), data)
      }
    }
  }

  try {
    addFolderToZip(rootFolderPath)
    const zipContent = await zip.generateAsync({type: 'nodebuffer'})
    fs.writeFileSync(zipPath, zipContent)
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to zip files: ${err.message}`)
    }
  }
}

/**
 * Creates the root folder and any subfolders
 * @param rootFolderPath path to the root folder
 * @param subFolders paths to any subfolders to be created
 * @throws Error if the root folder cannot be deleted or folders cannot be created
 */
export const createDirectories = (rootFolderPath: string, subFolders: string[]) => {
  try {
    fs.mkdirSync(rootFolderPath)
    for (const subFolder of subFolders) {
      fs.mkdirSync(subFolder)
    }
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to create directories: ${err.message}`)
    }
  }
}
