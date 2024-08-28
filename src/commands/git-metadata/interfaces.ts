export class CommitInfo {
  public hash: string
  public remote: string
  public trackedFiles: string[]

  constructor(hash: string, remote: string, trackedFiles: string[]) {
    this.hash = hash
    this.remote = remote
    this.trackedFiles = trackedFiles
  }
}
