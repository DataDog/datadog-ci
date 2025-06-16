/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export interface AasConfigOptions {
  subscriptionId: string
  resourceGroup: string
  aasName: string
  service?: string
  environment?: string
  isInstanceLoggingEnabled?: boolean
  logPath?: string
  isDotnet: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  shouldNotRestart?: boolean
}
