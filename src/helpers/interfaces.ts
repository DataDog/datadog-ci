export interface Metadata {
  ci: {
    job?: {
      name?: string
      url?: string
    }
    pipeline: {
      id?: string
      name?: string
      number?: string
      url?: string
    }
    provider: {
      name: string
    }
    stage?: {
      name?: string
    }
    workspacePath?: string
  }
  git: {
    branch?: string
    commitSha?: string
    repositoryUrl?: string
    tag?: string
  }
}
