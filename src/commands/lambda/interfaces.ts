export interface LambdaConfigOptions {
  flushMetricsToLogs?: boolean
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
