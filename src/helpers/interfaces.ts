export interface Metadata {
  ci: {
    job?: {
      url?: string;
      name?: string
    },
    stage?: {
      name?: string
    }
    pipeline: {
      id?: string
      name?: string
      number?: string
      url?: string
    }
    provider: {
      name: string
    },
    workspacePath?: string
  }
  git: {
    tag?: string
    repositoryUrl?: string
    branch?: string
    commitSha?: string
  }
}
