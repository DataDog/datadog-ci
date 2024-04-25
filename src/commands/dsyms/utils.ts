import {promises} from 'fs'
import {tmpdir} from 'os'
import path from 'path'

import rimraf from 'rimraf'

import {buildPath, execute} from '../../helpers/utils'

export const isZipFile = async (filepath: string) => {
  try {
    const stats = await promises.stat(filepath)

    return stats.size !== 0 && path.extname(filepath) === '.zip'
  } catch (error) {
    // Log to console "file exists yet empty" ?
    return false
  }
}

export const createUniqueTmpDirectory = async (): Promise<string> => {
  const uniqueValue = Math.random() * Number.MAX_SAFE_INTEGER
  const directoryPath = buildPath(tmpdir(), uniqueValue.toString())
  await promises.mkdir(directoryPath, {recursive: true})

  return directoryPath
}

export const deleteDirectory = async (directoryPath: string): Promise<void> =>
  new Promise((resolve, reject) => rimraf(directoryPath, () => resolve()))

export const zipDirectoryToArchive = async (directoryPath: string, archivePath: string) => {
  const cwd = path.dirname(directoryPath)
  const directoryName = path.basename(directoryPath)
  await execute(`zip -r '${archivePath}' '${directoryName}'`, cwd)
}

export const unzipArchiveToDirectory = async (archivePath: string, directoryPath: string) => {
  await promises.mkdir(directoryPath, {recursive: true})
  await execute(`unzip -o '${archivePath}' -d '${directoryPath}'`)
}

export const executeDwarfdump = async (dSYMPath: string): Promise<{stderr: string; stdout: string}> =>
  execute(`dwarfdump --uuid '${dSYMPath}'`)

export const executeLipo = async (
  objectPath: string,
  arch: string,
  newObjectPath: string
): Promise<{stderr: string; stdout: string}> => execute(`lipo '${objectPath}' -thin ${arch} -output '${newObjectPath}'`)

export const getBaseIntakeUrl = (datadogSite?: string) => {
  if (process.env.DATADOG_DSYM_INTAKE_URL) {
    return process.env.DATADOG_DSYM_INTAKE_URL
  } else if (datadogSite) {
    return 'https://sourcemap-intake.' + datadogSite
  }

  return 'https://sourcemap-intake.datadoghq.com'
}

export const pluralize = (nb: number, singular: string, plural: string) => {
  if (nb >= 2) {
    return `${nb} ${plural}`
  }

  return `${nb} ${singular}`
}
