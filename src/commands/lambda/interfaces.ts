export interface LambdaConfigOptions {
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  layerVersion?: string
  layerAWSAccount?: string
  functions: string[]
  region?: string
  tracing?: boolean
  mergeXrayTraces?: boolean
}
