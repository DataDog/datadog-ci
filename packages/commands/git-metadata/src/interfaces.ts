import {MultipartPayload, MultipartValue} from '@datadog/datadog-ci-core/helpers/upload'

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
        ['event', this.getMetadataPayload(cliVersion)],
        [
          'repository',
          {
            type: 'string',
            options: {
              contentType: 'application/json',
              filename: 'repository',
            },
            value: this.repositoryPayload(),
          },
        ],
      ]),
    }
  }

  private getMetadataPayload(cliVersion: string): MultipartValue {
    return {
      type: 'string',
      options: {
        contentType: 'application/json',
        filename: 'event',
      },
      value: JSON.stringify({
        cli_version: cliVersion,
        git_commit_sha: this.hash,
        git_repository_url: this.remote,
        type: 'repository',
      }),
    }
  }

  private repositoryPayload = (): string =>
    JSON.stringify({
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
