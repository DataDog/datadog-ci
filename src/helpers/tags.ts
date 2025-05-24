// Build
import fs from 'fs'

import chalk from 'chalk'
import {BaseContext} from 'clipanion'
import upath from 'upath'

import {getCISpanTags} from './ci'
import {DatadogCiConfig} from './config'
import {getGitMetadata} from './git/format-git-span-data'
import {SpanTag, SpanTags} from './interfaces'
import {getUserGitSpanTags} from './user-provided-git'
import {isFile} from './utils'

export const CI_PIPELINE_URL = 'ci.pipeline.url'
export const CI_PROVIDER_NAME = 'ci.provider.name'
export const CI_PIPELINE_ID = 'ci.pipeline.id'
export const CI_PIPELINE_NAME = 'ci.pipeline.name'
export const CI_PIPELINE_NUMBER = 'ci.pipeline.number'
export const CI_WORKSPACE_PATH = 'ci.workspace_path'
export const GIT_REPOSITORY_URL = 'git.repository_url'
export const CI_JOB_URL = 'ci.job.url'
export const CI_JOB_NAME = 'ci.job.name'
export const CI_STAGE_NAME = 'ci.stage.name'
export const CI_NODE_NAME = 'ci.node.name'
export const CI_NODE_LABELS = 'ci.node.labels'
export const CI_ENV_VARS = '_dd.ci.env_vars'

// Git
export const GIT_BRANCH = 'git.branch'
export const GIT_COMMIT_AUTHOR_DATE = 'git.commit.author.date'
export const GIT_COMMIT_AUTHOR_EMAIL = 'git.commit.author.email'
export const GIT_COMMIT_AUTHOR_NAME = 'git.commit.author.name'
export const GIT_COMMIT_COMMITTER_DATE = 'git.commit.committer.date'
export const GIT_COMMIT_COMMITTER_EMAIL = 'git.commit.committer.email'
export const GIT_COMMIT_COMMITTER_NAME = 'git.commit.committer.name'
export const GIT_COMMIT_MESSAGE = 'git.commit.message'
export const GIT_SHA = 'git.commit.sha'
export const GIT_TAG = 'git.tag'
export const GIT_HEAD_SHA = 'git.commit.head_sha'
export const GIT_BASE_REF = 'git.commit.base_ref'
export const GIT_PULL_REQUEST_BASE_BRANCH_SHA = 'git.pull_request.base_branch_sha'
export const GIT_PULL_REQUEST_BASE_BRANCH = 'git.pull_request.base_branch'

// PR
export const PR_NUMBER = 'pr.number'

// Sbom
export const SBOM_TOOL_GENERATOR_NAME = 'tool.generator.name'
export const SBOM_TOOL_GENERATOR_VERSION = 'tool.generator.version'

// General
export const SERVICE = 'service'

const parseNumericTag = (numericTag: string | undefined): number | undefined => {
  if (numericTag) {
    const number = parseFloat(numericTag)

    return isFinite(number) ? number : undefined
  }
}

/**
 * Receives an array of the form ['key:value', 'key2:value2']
 * and returns an object of the form {key: 'value', key2: 'value2'}
 */
export const parseTags = (tags: string[]): Record<string, string> => {
  try {
    return tags.reduce((acc, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }
      const firstColon = keyValuePair.indexOf(':')

      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      return {
        ...acc,
        [key]: value,
      }
    }, {})
  } catch (e) {
    return {}
  }
}

/**
 * Similar to `parseTags` but it's assumed that numbers are received
 * Receives an array of the form ['key:123', 'key2:321']
 * and returns an object of the form {key: 123, key2: 321}
 */
export const parseMetrics = (tags: string[]) => {
  try {
    return tags.reduce((acc, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }
      const firstColon = keyValuePair.indexOf(':')

      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      const number = parseNumericTag(value)

      if (number !== undefined) {
        return {
          ...acc,
          [key]: number,
        }
      }

      return acc
    }, {})
  } catch (e) {
    return {}
  }
}

/**
 * Receives a filepath to a JSON file that contains tags in the form of:
 * {
 *  "key": "value",
 *  "key2": "value2"
 * }
 * and returns a record of the form {key: 'value', key2: 'value2'}
 * Numbers are converted to strings and nested objects are ignored.
 * @param context - the context of the CLI, used to write to stdout and stderr
 * @param tagsFile - the path to the JSON file
 */
export const parseTagsFile = (
  context: BaseContext,
  tagsFile: string | undefined
): [Record<string, string>, boolean] => {
  if (!tagsFile || tagsFile === '') {
    return [{}, true]
  }

  const fileContent = readJsonFile(context, tagsFile)
  if (fileContent === '') {
    return [{}, false]
  }

  let tags: Record<string, string>
  try {
    tags = JSON.parse(fileContent) as Record<string, string>
  } catch (error) {
    context.stderr.write(`${chalk.red.bold('[ERROR]')} could not parse JSON file '${tagsFile}': ${error}\n`)

    return [{}, false]
  }

  // We want to ensure that all tags are strings
  for (const key in tags) {
    if (typeof tags[key] === 'object') {
      context.stdout.write(`${chalk.yellow.bold('[WARN]')} tag '${key}' had nested fields which will be ignored\n`)
      delete tags[key]
    } else if (typeof tags[key] !== 'string') {
      context.stdout.write(`${chalk.yellow.bold('[WARN]')} tag '${key}' was not a string, converting to string\n`)
      tags[key] = String(tags[key])
    }
  }

  return [tags, true]
}

/**
 * Similar to `parseTagsFile` but it's assumed that numbers are received
 * If a field is not a number, it will be ignored
 * @param context - the context of the CLI, used to write to stdout and stderr
 * @param measuresFile - the path to the JSON file
 */
export const parseMeasuresFile = (
  context: BaseContext,
  measuresFile: string | undefined
): [Record<string, number>, boolean] => {
  if (!measuresFile || measuresFile === '') {
    return [{}, true]
  }

  const fileContent = readJsonFile(context, measuresFile)
  if (fileContent === '') {
    return [{}, false]
  }

  let measures: Record<string, number>
  try {
    measures = JSON.parse(fileContent) as Record<string, number>
  } catch (error) {
    context.stderr.write(`${chalk.red.bold('[ERROR]')} could not parse JSON file '${measuresFile}': ${error}\n`)

    return [{}, false]
  }

  // We want to ensure that all tags are strings
  for (const key in measures) {
    if (typeof measures[key] !== 'number') {
      context.stdout.write(`${chalk.yellow.bold('[WARN]')} ignoring field '${key}' because it was not a number\n`)
      delete measures[key]
    }
  }

  return [measures, true]
}

/**
 * These are required git tags for the following commands: sarif and sbom.
 */
export const REQUIRED_GIT_TAGS: SpanTag[] = [
  GIT_REPOSITORY_URL,
  GIT_BRANCH,
  GIT_SHA,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
]

/**
 * A utility to determine which required git tags are missing.
 * @param tags - the tags to check
 * @returns an array of the missing required git tags (ex. ['git.repository_url', 'git.branch'])
 */
export const getMissingRequiredGitTags = (tags: SpanTags): string[] => {
  const missingTags = REQUIRED_GIT_TAGS.reduce((acc: string[], tag: SpanTag) => {
    if (!tags[tag] || (tags[tag] as string).trim() === '') {
      acc.push(tag)
    }

    return acc
  }, [])

  return missingTags
}

/**
 * Get the tags to upload results in CI for the following commands: sarif and sbom.
 * @param config - the configuration of the CLI
 * @param additionalTags - additional tags passed, generally from the command line.
 * @param includeCiTags - include CI tags or not
 */
export const getSpanTags = async (
  config: DatadogCiConfig,
  additionalTags: string[] | undefined,
  includeCiTags: boolean,
  gitPath?: string
): Promise<SpanTags> => {
  const ciSpanTags = includeCiTags ? getCISpanTags() : []
  const gitSpanTags = await getGitMetadata(gitPath)
  const userGitSpanTags = getUserGitSpanTags()

  const envVarTags = config.envVarTags ? parseTags(config.envVarTags.split(',')) : {}
  const cliTags = additionalTags ? parseTags(additionalTags) : {}

  return {
    // if users specify a git path to read from, we prefer git env variables over the CI context one
    ...(gitPath ? {...ciSpanTags, ...gitSpanTags} : {...gitSpanTags, ...ciSpanTags}),
    ...userGitSpanTags, // User-provided git tags have precedence over the ones we get from the git command
    ...cliTags,
    ...envVarTags,
    ...(config.env ? {env: config.env} : {}),
  }
}

const readJsonFile = (context: BaseContext, filename: string): string => {
  filename = upath.normalize(filename) // resolve relative paths
  if (!fs.existsSync(filename)) {
    context.stderr.write(`${chalk.red.bold('[ERROR]')} file '${filename}' does not exist\n`)

    return ''
  }
  if (!isFile(filename)) {
    context.stderr.write(`${chalk.red.bold('[ERROR]')} path '${filename}' did not point to a file\n`)

    return ''
  }
  if (upath.extname(filename) !== '.json') {
    context.stderr.write(`${chalk.red.bold('[ERROR]')} file '${filename}' is not a JSON file\n`)

    return ''
  }

  return String(fs.readFileSync(filename))
}
