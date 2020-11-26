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
    commitSha?: string
  }
  trace?: {
    parentSpanId: string
    traceId: string
  }
}
