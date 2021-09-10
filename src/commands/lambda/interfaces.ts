export interface LambdaConfigOptions {
  extensionVersion?: string
  flushMetricsToLogs?: string
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  logLevel?: string
  mergeXrayTraces?: string
  region?: string
  tracing?: string
}
