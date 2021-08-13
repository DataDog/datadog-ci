import chalk from 'chalk'

import {ICONS} from '../../helpers/formatting'
import {MultipartPayload, newMultipartValue} from '../../helpers/upload'

export class CommitInfo {
  public hash: string
  public remote: string
  public trackedFiles: string[]

  constructor(hash: string, remote: string, trackedFiles: string[]) {
    this.hash = hash
    this.remote = remote
    this.trackedFiles = trackedFiles
  }

  public asMultipartPayload(cliVersion: string): MultipartPayload {
    return {
      content: new Map([
        ['cli_version', newMultipartValue(cliVersion)],
        ['type', newMultipartValue('repository')],
        ['repository', newMultipartValue(this.repositoryPayload(), {
          contentType: 'application/json',
          filename: 'repository',
        })],
        ['git_repository_url', newMultipartValue(this.remote)],
        ['git_commit_sha', newMultipartValue(this.hash)],
      ]),
      renderFailedUpload: (errorMessage: string) =>
        chalk.red(`${ICONS.FAILED} Failed upload: ${errorMessage}\n`),
      renderRetry: (errorMessage: string, attempt: number) =>
        chalk.yellow(`[attempt ${attempt}] Retrying upload: ${errorMessage}\n`),
      renderUpload: () => 'Uploading\n',
    }
  }

  private repositoryPayload = (): string => JSON.stringify({
    data: [
      {
        files: this.trackedFiles,
        hash: this.hash,
        repository_url: this.remote,
      },
    ],
    // Make sure to update the version if the format of the JSON payloads changes in any way.
    version: 1,
  })
}
