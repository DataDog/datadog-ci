export interface Metadata {
  ci: {
    pipeline: {
      url?: string
    }
    provider: {
      name: string
    }
  }
  git: {
    branch?: string
    commit_sha?: string
  }
  trace?: {
    parentSpanId: string
    traceId: string
  }
}
