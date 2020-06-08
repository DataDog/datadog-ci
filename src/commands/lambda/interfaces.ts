export interface LambdaConfigOptions {
  forwarderARN?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
