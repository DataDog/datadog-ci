export interface LambdaConfigOptions {
  extensionVersion?: string
  flushMetricsToLogs?: boolean
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
