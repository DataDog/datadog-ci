import chalk from 'chalk'

const NPX_PATH_REGEX = /\.npm\/_npx\//
const NPX_PATH_WIN_REGEX = /\\npm[-\\]+cache\\_npx\\/

export const isRunViaNpx = (): boolean => {
  const script = process.argv[1] ?? ''

  return NPX_PATH_REGEX.test(script) || NPX_PATH_WIN_REGEX.test(script)
}

export const printNpxWarning = () => {
  process.stderr.write(
    chalk.yellow(
      `⚠ Warning: Running datadog-ci via npx is vulnerable to supply chain attacks due to transitive dependencies.\n` +
        `  Consider installing datadog-ci in your repository or CI with explicit versions and lock files.\n`
    )
  )
}

/**
 * Find where NPX just installed the package.
 *
 * https://github.com/geelen/npx-import/blob/8a1e17ca4f88981b11be5090e20871f8704166b8/src/index.ts#L221-L250
 */
export const getTempPath = (stdout: string, isWindows: boolean): string => {
  if (isWindows) {
    const paths = stdout
      .replace(/^PATH=/i, '')
      .replace(/\\r\\n/g, ';')
      .split(';')
    const tempPath = paths.find((p) => NPX_PATH_WIN_REGEX.exec(p))

    if (!tempPath) {
      const list = paths.map((p) => ` - ${p}`).join('\n')
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '\\npm-cache\\_npx\\' in:\n${list}`
      )
    }

    return tempPath
  } else {
    const paths = stdout.split(':')
    const tempPath = paths.find((p) => NPX_PATH_REGEX.exec(p))

    if (!tempPath) {
      const list = paths.map((p) => ` - ${p}`).join('\n')
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '/.npm/_npx/' in:\n${list}`
      )
    }

    return tempPath
  }
}
