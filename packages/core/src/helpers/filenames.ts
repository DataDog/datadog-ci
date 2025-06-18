import upath from 'upath'

/**
 * Generate unique file names
 * If the original file name is unique, keep it as is
 * Otherwise, replace separators in the file path with dashes
 * @param filePaths the list of file paths
 * @returns a mapping of file paths to new file names
 */
export const getUniqueFileNames = (filePaths: Set<string>): Map<string, string> => {
  // Count occurrences of each filename
  const fileNameCount: {[fileName: string]: number} = {}
  filePaths.forEach((filePath) => {
    const fileName = upath.basename(filePath)
    const count = fileNameCount[fileName] || 0
    fileNameCount[fileName] = count + 1
  })

  // Create new filenames
  const filePathsToNewFileNames = new Map<string, string>()
  filePaths.forEach((filePath) => {
    const fileName = upath.basename(filePath)
    if (fileNameCount[fileName] > 1) {
      // Trim leading and trailing '/'s and '\'s
      const trimRegex = /^\/+|\/+$/g
      const filePathTrimmed = filePath.replace(trimRegex, '')
      // Replace '/'s and '\'s with '-'s
      const newFileName = filePathTrimmed.split('/').join('-')
      filePathsToNewFileNames.set(filePath, newFileName)
    } else {
      filePathsToNewFileNames.set(filePath, fileName)
    }
  })

  return filePathsToNewFileNames
}
