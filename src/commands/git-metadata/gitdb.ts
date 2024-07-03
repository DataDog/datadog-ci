import child_process from 'child_process'
import fs from 'fs'
import {mkdtemp} from 'fs/promises'
import os from 'os'
import path from 'path'

import type {AxiosResponse} from 'axios'

import FormData from 'form-data'
import {lte} from 'semver'
import * as simpleGit from 'simple-git'

import {getDefaultRemoteName, gitRemote as getRepoURL} from '../../helpers/git/get-git-data'
import {RequestBuilder} from '../../helpers/interfaces'
import {Logger} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'

const API_TIMEOUT = 15000

// we only consider recent commits to avoid uploading the whole repository
// at most 1000 commits or > 1 month of data is considered.
const MAX_HISTORY = {
  maxCommits: 1000,
  oldestCommits: '1 month ago',
}

const getCommitsToInclude = async (
  log: Logger,
  request: RequestBuilder,
  git: simpleGit.SimpleGit,
  repositoryURL: string
) => {
  let latestCommits: string[]
  try {
    latestCommits = await getLatestLocalCommits(git)
    if (latestCommits.length === 0) {
      log.debug('No local commits found.')

      return {
        commitsToInclude: [],
        commitsToExclude: [],
        headCommit: '',
      }
    }
    log.debug(`${latestCommits.length} commits found, asking GitDB which ones are missing.`)
  } catch (err) {
    log.warn(`Failed getting local commits: ${err}`)
    throw err
  }

  let commitsToExclude: string[]
  try {
    commitsToExclude = await getKnownCommits(log, request, repositoryURL, latestCommits)
    log.debug(`${commitsToExclude.length} commits already in GitDB.`)
  } catch (err) {
    log.warn(`Failed getting commits to exclude: ${err}`)
    throw err
  }

  return {
    commitsToInclude: latestCommits.filter((x) => !commitsToExclude.includes(x)),
    commitsToExclude,
    headCommit: latestCommits[0],
  }
}

export const uploadToGitDB = async (
  log: Logger,
  request: RequestBuilder,
  git: simpleGit.SimpleGit,
  dryRun: boolean,
  repositoryURL?: string
) => {
  let repoURL
  if (repositoryURL) {
    repoURL = repositoryURL
  } else {
    try {
      repoURL = await getRepoURL(git)
      log.debug(`Syncing repository ${repoURL}`)
    } catch (err) {
      log.warn(`Failed getting repository URL: ${err}`)
      throw err
    }
  }

  let commitsToInclude: string[]
  let commitsToExclude: string[]
  let headCommit: string

  const getCommitsBeforeUnshallowing = await getCommitsToInclude(log, request, git, repoURL)

  commitsToInclude = getCommitsBeforeUnshallowing.commitsToInclude
  commitsToExclude = getCommitsBeforeUnshallowing.commitsToExclude
  headCommit = getCommitsBeforeUnshallowing.headCommit

  // If there are no commits to include, it means the backend already has all the commits.
  if (commitsToInclude.length === 0) {
    return
  }
  // If there are commits to include and the repository is shallow, we need to repeat the process after unshallowing
  const isShallow = await isShallowRepository(git)
  if (isShallow) {
    await unshallowRepository(log, git)
    const getCommitsAfterUnshallowing = await getCommitsToInclude(log, request, git, repoURL)
    commitsToInclude = getCommitsAfterUnshallowing.commitsToInclude
    commitsToExclude = getCommitsAfterUnshallowing.commitsToExclude
    headCommit = getCommitsBeforeUnshallowing.headCommit
  }

  // Get the list of all objects (commits, trees) to upload. This list can be quite long
  // so quite memory intensive (multiple MBs).
  let objectsToUpload
  try {
    objectsToUpload = await getObjectsToUpload(git, commitsToInclude, commitsToExclude)
    log.debug(`${objectsToUpload.length} objects to upload.`)
  } catch (err) {
    log.warn(`Failed getting objects to upload: ${err}`)
    throw err
  }

  let packfiles
  let tmpDir
  try {
    ;[packfiles, tmpDir] = await generatePackFilesForCommits(log, objectsToUpload)
    log.debug(`${packfiles.length} packfiles generated.`)
  } catch (err) {
    log.warn(`Failed generating packfiles: ${err}`)
    throw err
  }

  try {
    if (dryRun) {
      log.debug(`Dry-run enabled, not uploading anything.`)

      return
    }
    log.debug(`Uploading packfiles...`)
    await uploadPackfiles(log, request, repoURL, headCommit, packfiles)
    log.debug('Successfully uploaded packfiles.')
  } catch (err) {
    log.warn(`Failed to upload packfiles: ${err}`)
    throw err
  } finally {
    if (tmpDir !== undefined) {
      fs.rmSync(tmpDir, {recursive: true})
    }
  }
}

const getLatestLocalCommits = async (git: simpleGit.SimpleGit) => {
  // we add some boundaries to avoid retrieving ALL commits here.
  const logResult = await git.log([`-n ${MAX_HISTORY.maxCommits}`, `--since="${MAX_HISTORY.oldestCommits}"`])

  return logResult.all.map((c) => c.hash)
}

const isShallowRepository = async (git: simpleGit.SimpleGit) => {
  const gitversion = String(await git.version())
  if (lte(gitversion, '2.27.0')) {
    return false
  }

  return (await git.revparse('--is-shallow-repository')) === 'true'
}

const unshallowRepository = async (log: Logger, git: simpleGit.SimpleGit) => {
  log.info('[unshallow] Git repository is a shallow clone, unshallowing it...')

  const [headCommit, remoteName] = await Promise.all([git.revparse('HEAD'), getDefaultRemoteName(git)])
  const baseCommandLogLine = `[unshallow] Running git fetch --shallow-since="${MAX_HISTORY.oldestCommits}" --update-shallow --filter=blob:none --recurse-submodules=no`

  log.info(`${baseCommandLogLine} $(git config --default origin --get clone.defaultRemoteName) $(git rev-parse HEAD)`)

  try {
    await git.fetch([
      `--shallow-since="${MAX_HISTORY.oldestCommits}"`,
      '--update-shallow',
      '--filter=blob:none',
      '--recurse-submodules=no',
      remoteName,
      headCommit,
    ])
  } catch (err) {
    // If the local HEAD is a commit that has not been pushed to the remote, the above command will fail.
    log.warn(`[unshallow] Failed to unshallow: ${err}`)
    try {
      log.info(
        `${baseCommandLogLine} $(git config --default origin --get clone.defaultRemoteName) $(git rev-parse --abbrev-ref --symbolic-full-name @{upstream})`
      )
      const upstreamRemote = await git.revparse('--abbrev-ref --symbolic-full-name @{upstream}')
      await git.fetch([
        `--shallow-since="${MAX_HISTORY.oldestCommits}"`,
        '--update-shallow',
        '--filter=blob:none',
        '--recurse-submodules=no',
        remoteName,
        upstreamRemote,
      ])
    } catch (secondError) {
      // If the CI is working on a detached HEAD or branch tracking hasn’t been set up, the above command will fail.
      log.warn(`[unshallow] Failed to unshallow again: ${secondError}`)
      log.info(`${baseCommandLogLine} $(git config --default origin --get clone.defaultRemoteName)`)
      await git.fetch([
        `--shallow-since="${MAX_HISTORY.oldestCommits}"`,
        '--update-shallow',
        '--filter=blob:none',
        '--recurse-submodules=no',
        remoteName,
      ])
    }
  }
  log.info('[unshallow] Fetch completed.')
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

    return validateCommit(c.id)
  })
}

const validateCommit = (sha: string) => {
  const isValidSha1 = (s: string) => /^[0-9a-f]{40}$/.test(s)
  const isValidSha256 = (s: string) => /^[0-9a-f]{64}$/.test(s)

  if (!isValidSha1(sha) && !isValidSha256(sha)) {
    throw new Error(`Invalid commit format: ${sha}`)
  }

  return sha
}

const getObjectsToUpload = async (git: simpleGit.SimpleGit, commitsToInclude: string[], commitsToExclude: string[]) => {
  const rawResponse = await git.raw(
    ['rev-list', '--objects', '--no-object-names', '--filter=blob:none', `--since="${MAX_HISTORY.oldestCommits}"`]
      .concat(commitsToExclude.map((sha) => '^' + sha))
      .concat(commitsToInclude)
  )
  const objectsToInclude = rawResponse.split('\n').filter((c) => c !== '')

  return objectsToInclude
}

const generatePackFilesForCommits = async (log: Logger, commits: string[]): Promise<[string[], string | undefined]> => {
  if (commits.length === 0) {
    return [[], undefined]
  }

  const generatePackfiles = async (baseTmpPath: string): Promise<[string[], string | undefined]> => {
    const randomPrefix = String(Math.floor(Math.random() * 10000))
    const tmpPath = await mkdtemp(path.join(baseTmpPath, 'dd-packfiles-'))
    const packfilePath = path.join(tmpPath, randomPrefix)
    const packObjectResults = child_process
      .execSync(`git pack-objects --compression=9 --max-pack-size=3m ${packfilePath}`, {
        input: commits.join('\n'),
      })
      .toString()
      .split('\n')
      .filter((sha) => sha.length > 0)
      .map((sha) => `${packfilePath}-${sha}.pack`)

    return [packObjectResults, tmpPath]
  }

  // Try using tmp folder first:
  try {
    return await generatePackfiles(os.tmpdir())
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

    return generatePackfiles(process.cwd())
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
