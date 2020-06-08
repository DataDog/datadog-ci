export interface LambdaConfigOptions {
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
