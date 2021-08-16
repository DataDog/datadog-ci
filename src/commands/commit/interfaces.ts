import {MultipartPayload} from '../../helpers/upload'

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
        ['cli_version', {value: cliVersion}],
        ['type', {value: 'repository'}],
        ['repository', {
          options: {
            contentType: 'application/json',
            filename: 'repository',
          },
          value: this.repositoryPayload(),
        }],
        ['git_repository_url', {value: this.remote}],
        ['git_commit_sha', {value: this.hash}],
      ]),
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
