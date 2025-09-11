import {renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {filterAndFormatGithubRemote} from '@datadog/datadog-ci-base/helpers/utils'
import {BaseContext, Cli} from 'clipanion'

import {getCommitInfo, newSimpleGit} from './git'
import {UploadCommand} from './upload'

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

export const uploadGitData = async (context: BaseContext) => {
  const cli = new Cli()
  cli.register(UploadCommand)
  if ((await cli.run(['git-metadata', 'upload'], context)) !== 0) {
    throw Error("Couldn't upload git metadata")
  }

  return
}

export const handleSourceCodeIntegration = async (
  context: BaseContext,
  uploadGitMetadata: boolean,
  extraTags: string | undefined
) => {
  try {
    const gitData = await getGitData()
    if (uploadGitMetadata) {
      await uploadGitData(context)
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
