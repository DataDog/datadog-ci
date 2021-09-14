export interface LambdaConfigOptions {
  environment?: string
  extensionVersion?: string
  extraTags?: string
  flushMetricsToLogs?: string
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  logLevel?: string
  mergeXrayTraces?: string
  region?: string
  service?: string
  tracing?: string
  version?: string
}
