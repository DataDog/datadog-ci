import {exec} from 'child_process'
import {promises} from 'fs'
import glob from 'glob'
import {tmpdir} from 'os'
import path from 'path'
import {promisify} from 'util'

import {Payload} from './interfaces'

import {buildPath} from '../../helpers/utils'

const UUID_REGEX = '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}'

const globAsync = promisify(glob)

export const isZipFile = async (filepath: string) => {
  try {
    const stats = await promises.stat(filepath)

    return stats.size !== 0 && path.extname(filepath) === '.zip'
  } catch (error) {
    // Log to console "file exists yet empty" ?
    return false
  }
}

export const getMatchingDSYMFiles = async (absoluteFolderPath: string): Promise<Payload[]> => {
  const dSYMFiles = await globAsync(buildPath(absoluteFolderPath, '**/*.dSYM'))

  return Promise.all(
    dSYMFiles.map(async (dSYMPath) => {
      const uuids = await dwarfdumpUUID(dSYMPath)

      return {
        path: dSYMPath,
        type: 'ios_symbols',
        uuids,
      }
    })
  )
}

export const dwarfdumpUUID = async (filePath: string) => {
  const output = await execute(`dwarfdump --uuid ${filePath}`)

  const uuids: string[] = []
  output.stdout.split('\n').forEach((line: string) => {
    const regexMatches = line.match(UUID_REGEX)
    if (regexMatches && regexMatches.length > 0) {
      uuids.push(regexMatches[0])
    }
  })

  return uuids
}

const tmpFolder = buildPath(tmpdir(), 'datadog-ci', 'dsyms')

export const zipToTmpDir = async (sourcePath: string, targetFilename: string): Promise<string> => {
  await promises.mkdir(tmpFolder, {recursive: true})
  const targetPath = buildPath(tmpFolder, targetFilename)
  const sourceDir = path.dirname(sourcePath)
  const sourceFile = path.basename(sourcePath)
  // `zip -r foo.zip f1/f2/f3/foo.dSYM`
  // this keeps f1/f2/f3 folders in foo.zip, we don't want this
  // `cwd: sourceDir` is passed to avoid that
  await execute(`zip -r ${targetPath} ${sourceFile}`, sourceDir)

  return targetPath
}

export const unzipToTmpDir = async (sourcePath: string): Promise<string> => {
  const targetPath = buildPath(tmpFolder, path.basename(sourcePath, '.zip'), Date.now().toString())
  const dirPath = path.dirname(targetPath)
  await promises.mkdir(dirPath, {recursive: true})
  await execute(`unzip -o ${sourcePath} -d ${targetPath}`)

  return targetPath
}

const execProc = promisify(exec)
const execute = (cmd: string, cwd: string | undefined = undefined): Promise<{stderr: string; stdout: string}> =>
  execProc(cmd, {
    cwd,
    maxBuffer: 5 * 1024 * 5000,
  })

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_DSYM_INTAKE_URL) {
    return process.env.DATADOG_DSYM_INTAKE_URL
  } else if (process.env.DATADOG_SITE) {
    return 'https://sourcemap-intake.' + process.env.DATADOG_SITE
  }

  return 'https://sourcemap-intake.datadoghq.com'
}

export const getBaseAPIUrl = () => {
  if (process.env.DATADOG_SITE) {
    return 'api.' + process.env.DATADOG_SITE
  }

  return 'api.datadoghq.com'
}

export const pluralize = (nb: number, singular: string, plural: string) => {
  if (nb >= 2) {
    return `${nb} ${plural}`
  }

  return `${nb} ${singular}`
}
