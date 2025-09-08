import {renderSoftWarning} from './renderer'
import {filterAndFormatGithubRemote} from './utils'
import {BaseContext} from 'clipanion'

import {newSimpleGit, getCommitInfo} from './git/git-utils'

const getGitData = async () => {
  let currentStatus

  try {
    currentStatus = await getCurrentGitStatus()
  } catch (err) {
    throw Error("Couldn't get local git status")
  }

  if (!currentStatus.isClean) {
    throw Error('Local git repository is dirty')
  }

  if (currentStatus.ahead > 0) {
    throw Error('Local changes have not been pushed remotely. Aborting git data tagging.')
  }

  const gitRemote = filterAndFormatGithubRemote(currentStatus.remote)

  return {commitSha: currentStatus.hash, gitRemote}
}

export const getCurrentGitStatus = async () => {
  const simpleGit = await newSimpleGit()
  const gitCommitInfo = await getCommitInfo(simpleGit)
  if (gitCommitInfo === undefined) {
    throw new Error('Git commit info is not defined')
  }
  const status = await simpleGit.status()

  return {
    isClean: status.isClean(),
    ahead: status.ahead,
    files: status.files,
    hash: gitCommitInfo?.hash,
    remote: gitCommitInfo?.remote,
  }
}

export const handleSourceCodeIntegration = async (
  context: BaseContext,
  uploadGitMetadata: boolean,
  extraTags: string | undefined
) => {
  try {
    const gitData = await getGitData()

    // Note: uploadGitMetadata functionality is not available in base package
    // This would need to be handled by the consuming package if needed
    if (uploadGitMetadata) {
      context.stdout.write(renderSoftWarning('Git metadata upload is not available in base package. Continuing without upload.'))
    }

    if (extraTags) {
      extraTags += `,git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
    } else {
      extraTags = `git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
    }
  } catch (err) {
    context.stdout.write(renderSoftWarning(`Couldn't add source code integration, continuing without it. ${err}`))
  }

  return extraTags
}
