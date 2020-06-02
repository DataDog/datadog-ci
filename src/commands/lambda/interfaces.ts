export interface LambdaConfigOptions {
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  mergeXrayTraces?: boolean
  region?: string
  tracing?: boolean
}
