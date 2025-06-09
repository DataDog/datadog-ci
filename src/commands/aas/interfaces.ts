/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export interface AasConfigOptions {
  subscriptionId: string
  resourceGroup: string
  aasName: string
  service: string | undefined
  environment: string | undefined
  isInstanceLoggingEnabled: boolean
  logPath: string | undefined
}

export type ValueOptional<T> = {
  [K in keyof T]: T[K] | undefined
}
