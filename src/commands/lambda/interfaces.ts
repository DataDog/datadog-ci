export interface LambdaConfigOptions {
  extensionVersion?: string
  flushMetricsToLogs?: boolean
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  logLevel?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
