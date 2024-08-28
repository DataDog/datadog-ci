import {SimpleGit} from 'simple-git'

import {Logger, LogLevel} from '../../helpers/logger'
import {getRequestBuilder, filterAndFormatGithubRemote} from '../../helpers/utils'

import {getCommitInfo, newSimpleGit} from './git'
import {uploadToGitDB} from './gitdb'

export const isGitRepo = async (): Promise<boolean> => {
  try {
    const simpleGit = await newSimpleGit()
    const isRepo = simpleGit.checkIsRepo()

    return isRepo
  } catch {
    return false
  }
}

// getGitCommitInfo returns the current [repositoryURL, commitHash]. If parameter
// filterAndFormatGitRepoUrl == true, the repositoryURL will have sensitive information filtered and
// git prefix normalized.
// ("git@github.com:" and "https://github.com/" prefixes will be normalized into "github.com/")
export const getGitCommitInfo = async (filterAndFormatGitRepoUrl = true): Promise<[string, string]> => {
  const simpleGit = await newSimpleGit()
  const payload = await getCommitInfo(simpleGit)

  const gitRemote = filterAndFormatGitRepoUrl ? filterAndFormatGithubRemote(payload.remote) : payload.remote

  // gitRemote will never be undefined, as filterAndFormatGithubRemote will ONLY return undefined if it's
  // parameter value is also undefined. Added the " gitRemote ?? '' " to make the typechecker happy.
  return [gitRemote ?? '', payload.hash]
}

// uploadGitCommitHash uploads local git metadata and returns the current [repositoryURL, commitHash].
// The current repositoryURL can be overridden by specifying the 'repositoryURL' arg.
export const uploadGitCommitHash = async (
  apiKey: string,
  datadogSite: string,
  repositoryURL?: string
): Promise<[string, string]> => {
  const simpleGit = await newSimpleGit()
  const payload = await getCommitInfo(simpleGit, repositoryURL)

  return syncGitDB(simpleGit, apiKey, datadogSite, payload.remote).then(() => [payload.remote, payload.hash])
}

const syncGitDB = async (simpleGit: SimpleGit, apiKey: string, datadogSite: string, repositoryURL: string) => {
  // no-op logger
  const log = new Logger((s: string) => {}, LogLevel.INFO)

  const requestBuilder = getRequestBuilder({
    apiKey,
    baseUrl: 'https://api.' + datadogSite,
  })

  await uploadToGitDB(log, requestBuilder, simpleGit, false, repositoryURL)
}
