import child_process from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {AxiosResponse} from 'axios'
import FormData from 'form-data'
import * as simpleGit from 'simple-git'

import {RequestBuilder} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'

import {gitRemote} from './git'
import {Logger} from './utils'

const API_TIMEOUT = 15000

export const uploadToGitDB = async (
  log: Logger,
  request: RequestBuilder,
  git: simpleGit.SimpleGit,
  dryRun: boolean
) => {
  let repoURL
  try {
    repoURL = await getRepoURL(git)
    log.debug(`Syncing repository ${repoURL}`)
  } catch (err) {
    log.warn(`Failed getting repository URL: ${err}`)
    throw err
  }

  let latestCommits
  try {
    latestCommits = await getLatestLocalCommits(git)
    if (latestCommits.length === 0) {
      log.debug('No local commits found.')

      return
    }
    log.debug(`${latestCommits.length} commits found, asking GitDB which ones are missing.`)
  } catch (err) {
    log.warn(`Failed getting local commits: ${err}`)
    throw err
  }

  let commitsToExclude
  try {
    commitsToExclude = await getKnownCommits(log, request, repoURL, latestCommits)
    log.debug(`${commitsToExclude.length} commits already in GitDB.`)
  } catch (err) {
    log.warn(`Failed getting commits to exclude: ${err}`)
    throw err
  }

  // Get the list of all objects (commits, trees) to upload. This list can be quite long
  // so quite memory intensive (multiple MBs).
  let objectsToUpload
  try {
    objectsToUpload = await getObjectsToUpload(git, commitsToExclude)
    log.debug(`${objectsToUpload.length} objects to upload.`)
  } catch (err) {
    log.warn(`Failed getting objects to upload: ${err}`)
    throw err
  }

  let packfiles
  try {
    packfiles = generatePackFilesForCommits(log, objectsToUpload)
    log.debug(`${packfiles.length} packfiles generated.`)
  } catch (err) {
    log.warn(`Failed generating packfiles: ${err}`)
    throw err
  }

  if (dryRun) {
    log.debug(`Dry-run enabled, not uploading anything.`)

    return
  }
  log.debug(`Uploading packfiles...`)
  try {
    await uploadPackfiles(log, request, repoURL, latestCommits[0], packfiles)
    log.debug(`Successfully uploaded packfiles.`)
  } catch (err) {
    log.warn(`Failed to upload packfiles: ${err}`)
    throw err
  }
}

const getRepoURL = gitRemote

const getLatestLocalCommits = async (git: simpleGit.SimpleGit) => {
  const logResult = await git.log(['-n 1000', '--since="1 month ago"'])

  return logResult.all.map((c) => c.hash)
}

// getKnownCommits asks the backend which of the given commits are already known
const getKnownCommits = async (log: Logger, request: RequestBuilder, repoURL: string, latestCommits: string[]) => {
  interface SearchCommitResponse {
    data: Commit[]
  }

  interface Commit {
    type: string
    id: string
  }

  const localCommitData = JSON.stringify({
    meta: {
      repository_url: repoURL,
    },
    data: latestCommits.map((commit) => ({
      id: commit,
      type: 'commit',
    })),
  })
  const response = await runRequest(log, 'search_commits', () =>
    request({
      url: '/api/v2/git/repository/search_commits',
      headers: {
        'Content-Type': 'application/json',
      },
      data: localCommitData,
      method: 'POST',
      timeout: API_TIMEOUT,
    })
  )
  const commits = response.data as SearchCommitResponse
  if (!commits || commits.data === undefined) {
    throw new Error(`Invalid API response: ${response}`)
  }

  return commits.data.map((c) => {
    if (c.type !== 'commit' || c.id === undefined) {
      throw new Error('Invalid commit type response')
    }

    return sanitizeCommit(c.id)
  })
}

const sanitizeCommit = (sha: string) => {
  const isValidSha = (s: string) => /[0-9a-f]{40}/.test(s)

  const sanitizedCommit = sha.replace(/[^0-9a-f]+/g, '')
  if (sanitizedCommit !== sha) {
    throw new Error(`Invalid commit format: ${sha} (different from sanitized ${sanitizedCommit})`)
  }
  if (!isValidSha(sanitizedCommit)) {
    throw new Error(`Invalid commit format: ${sanitizedCommit}`)
  }

  return sanitizedCommit
}

const getObjectsToUpload = async (git: simpleGit.SimpleGit, commitsToExclude: string[]) => {
  const rawResponse = await git.raw(
    ['rev-list', '--objects', '--no-object-names', '--filter=blob:none', '--since="1 month ago"', 'HEAD'].concat(
      commitsToExclude.map((sha) => '^' + sha)
    )
  )
  const commitsToInclude = rawResponse.split('\n').filter((c) => c !== '')

  return commitsToInclude
}

// need to transform into async here.
const generatePackFilesForCommits = (log: Logger, commits: string[]) => {
  if (commits.length <= 0) {
    return []
  }

  const generatePackfiles = (packfilePath: string) => {
    const packObjectResults = child_process
      .execSync(`git pack-objects --compression=9 --max-pack-size=3m ${packfilePath}`, {
        input: commits.join('\n'),
      })
      .toString()
      .split('\n')
      .filter((sha) => sha)
      .map((sha) => `${packfilePath}-${sha}.pack`)

    return packObjectResults
  }

  // Try using tmp folder first:
  try {
    const tmpFolder = os.tmpdir()
    const randomPrefix = String(Math.floor(Math.random() * 10000))
    const tmpPath = path.join(tmpFolder, randomPrefix)

    return generatePackfiles(tmpPath)
  } catch (err) {
    /**
     * The generation of pack files in the temporary folder (from `os.tmpdir()`)
     * sometimes fails in certain CI setups with the error message
     * `unable to rename temporary pack file: Invalid cross-device link`.
     * The reason why is unclear.
     *
     * A workaround is to attempt to generate the pack files in `process.cwd()`.
     * While this works most of the times, it's not ideal since it affects the git status.
     * This workaround is intended to be temporary.
     *
     * TODO: fix issue and remove workaround.
     */
    log.warn(`Failed generation of packfiles in tmpdir: ${err}`)
    log.warn(`Generating them in ${process.cwd()} instead`)
    const randomPrefix = String(Math.floor(Math.random() * 10000))
    const cwdPath = path.join(process.cwd(), randomPrefix)

    return generatePackfiles(cwdPath)
  }
}

export const uploadPackfiles = async (
  log: Logger,
  request: RequestBuilder,
  repoURL: string,
  headCommit: string,
  packfilePaths: string[]
) => {
  // this loop makes sure requests are performed sequentially
  for (const pack of packfilePaths) {
    await uploadPackfile(log, request, repoURL, headCommit, pack)
  }
}

export const uploadPackfile = async (
  log: Logger,
  request: RequestBuilder,
  repoURL: string,
  headCommit: string,
  packfilePath: string
) => {
  const pushedSha = JSON.stringify({
    data: {
      id: headCommit,
      type: 'commit',
    },
    meta: {
      repository_url: repoURL,
    },
  })

  const form = new FormData()

  form.append('pushedSha', pushedSha, {contentType: 'application/json'})
  const packFileContent = fs.readFileSync(packfilePath)
  // The original filename includes a random prefix, so we remove it here
  const [, filename] = path.basename(packfilePath).split('-')
  form.append('packfile', packFileContent, {
    filename,
    contentType: 'application/octet-stream',
  })

  return runRequest(log, 'packfile', () =>
    request({
      url: '/api/v2/git/repository/packfile',
      headers: {
        ...form.getHeaders(),
      },
      timeout: API_TIMEOUT,
      data: form,
      method: 'POST',
    })
  )
}

// runRequest will run the passed request, with retries of retriable errors + logging of any retry attempt.
const runRequest = async <T>(log: Logger, reqName: string, request: () => Promise<AxiosResponse<T>>) => {
  return retryRequest(request, {
    retries: 2,
    onRetry: (e, attempt) => {
      let errorMessage = `${e}`
      const maybeHttpError = e as any
      if (maybeHttpError.response && maybeHttpError.response.statusText) {
        errorMessage = `${maybeHttpError.message} (${maybeHttpError.response.statusText})`
      }
      log.warn(`[attempt ${attempt}] Retrying ${reqName} request: ${errorMessage}`)
    },
  })
}
