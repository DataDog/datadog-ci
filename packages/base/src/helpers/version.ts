import {readFileSync} from 'fs'
import path from 'path'

/**
 * Get the CLI version from package.json
 * @param packagePath Optional path to package.json, defaults to searching up from current directory
 * @returns The version string from package.json
 */
export const getCliVersion = (packagePath?: string): string => {
  if (packagePath) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
    return require(packagePath).version as string
  }

  // Try to find package.json by walking up directories
  let currentDir = __dirname
  for (let i = 0; i < 10; i++) {
    try {
      const packageJsonPath = path.join(currentDir, 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.version) {
        return packageJson.version as string
      }
    } catch {
      // Continue searching up
    }
    currentDir = path.dirname(currentDir)
  }

  // Fallback: use require to get the package.json relative to this module
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
    return require('../package.json').version as string
  } catch {
    return 'unknown'
  }
}
