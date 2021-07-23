import {exec} from 'child_process'
import {mkdirSync} from 'fs'
import glob from 'glob'
import path from 'path'
import {promisify} from 'util'
import {buildPath} from '../../helpers/utils'
import {Payload} from './interfaces'
import {checkNonEmptyFile} from './validation'

const UUID_REGEX = '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}'

const getMatchingDSYMFiles = async (absoluteFolderPath: string): Promise<Payload[]> => {
  const dSYMFiles = glob.sync(buildPath(absoluteFolderPath, '**/*.dSYM'))

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

export const getPayloads = async (searchPaths: string[]): Promise<Payload[]> => {
  const nestedPayloads = await Promise.all(searchPaths.map((searchPath: string) => getMatchingDSYMFiles(searchPath)))

  return nestedPayloads.flat()
}

export const getSearchPaths = async (baseSearchPath: string): Promise<string[]> => {
  const zipFiles = getZipFiles(baseSearchPath)
  const unzipFolder = buildPath('/tmp', 'datadog-ci', 'dsyms')
  const searchPaths = (await Promise.all(
    zipFiles
      .map(async (zipFile: string) => {
        const unzipPath = buildPath(unzipFolder, path.basename(zipFile, '.zip'))
        try {
          await unzip(zipFile, unzipPath)

          return unzipPath
        } catch (err) {
          console.log(err)
        }
      })
      .filter((item) => item !== undefined)
  )) as string[]
  searchPaths.push(baseSearchPath)

  return searchPaths
}

export const getZipFiles = (absoluteFolderPath: string): string[] => {
  const zipFiles = glob.sync(buildPath(absoluteFolderPath, '*.zip'))

  return zipFiles.filter((file: string) => checkNonEmptyFile(file))
}

const dwarfdumpUUID = async (filePath: string) => {
  const output = await execute('dwarfdump', ['--uuid', filePath])

  const uuids: string[] = []
  output.stdout.split('\n').forEach((line: string) => {
    const regexMatches = line.match(UUID_REGEX)
    if (regexMatches && regexMatches.length > 0) {
      uuids.push(regexMatches[0])
    }
  })

  return uuids
}

export const zip = (sourcePath: string, targetPath: string) => {
  const dirPath = path.dirname(targetPath)
  mkdirSync(dirPath, {recursive: true})

  const sourceDir = path.dirname(sourcePath)
  const sourceFile = path.basename(sourcePath)

  // `zip -r foo.zip f1/f2/f3/foo.dSYM`
  // this keeps f1/f2/f3 folders in foo.zip, we don't want this
  // `cd ${sourceDir}` is called to avoid that
  return execute(`cd ${sourceDir} && zip`, ['-r', targetPath, sourceFile])
}

const unzip = (sourcePath: string, targetPath: string) => {
  const dirPath = path.dirname(targetPath)
  mkdirSync(dirPath, {recursive: true})

  return execute('unzip', ['-o', sourcePath, '-d', targetPath])
}

const execProc = promisify(exec)
const execute = (cmd: string, args: string[], {env = process.env} = {}) =>
  execProc(`${cmd} ${args.join(' ')}`, {
    env,
    maxBuffer: 5 * 1024 * 5000,
  }).then((output: {stderr: string; stdout: string}) => output)

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
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
