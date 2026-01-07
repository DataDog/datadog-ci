import {openSync, fstatSync, readSync, closeSync} from 'fs'

import upath from 'upath'

// Reads the last non-empty line from a file using a buffer from the end
export const readLastLine = (filePath: string): string => {
  let fd: number | undefined
  let lastLine = ''

  try {
    fd = openSync(filePath, 'r')
    const stats = fstatSync(fd)
    const fileSize = stats.size

    // Read up to 1KB from the end (should be enough for sourceMappingURL comment)
    const bufferSize = Math.min(1024, fileSize)
    const buffer = Buffer.alloc(bufferSize)
    const position = Math.max(0, fileSize - bufferSize)

    readSync(fd, buffer, 0, bufferSize, position)
    const tailContent = buffer.toString('utf-8')

    // Get the last non-empty line (handle multiple trailing newlines)
    const lines = tailContent.split('\n')
    for (const line of lines.reverse()) {
      if (line.trim().length !== 0) {
        lastLine = line
        break
      }
    }
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }

  return lastLine
}

export const getMinifiedFilePath = (sourcemapPath: string) => {
  if (upath.extname(sourcemapPath) !== '.map') {
    throw Error('cannot get minified file path from a file which is not a sourcemap')
  }

  return sourcemapPath.replace(new RegExp('\\.map$'), '')
}

// ExtractRepeatedPath checks if the last part of paths of the first arg are repeated at the start of the second arg.
export const extractRepeatedPath = (path1: string, path2: string): string | undefined => {
  const splitOnSlashes = new RegExp(/[/]+|[\\]+/)
  const trimSlashes = new RegExp(/^[/]+|^[\\]+|[/]+$|[\\]+$/)
  const path1split = path1.trim().replace(trimSlashes, '').split(splitOnSlashes)
  const path2split = path2.trim().replace(trimSlashes, '').split(splitOnSlashes)
  const normalizedpath2 = path2split.join('/')
  for (let i = path1split.length; i > 0; i--) {
    const path1subset = path1split.slice(-i).join('/')
    if (normalizedpath2.startsWith(path1subset)) {
      return path1subset
    }
  }

  return undefined
}
