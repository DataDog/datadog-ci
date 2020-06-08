export interface LambdaConfigOptions {
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
  forwarderARN?: string
}
