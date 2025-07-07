/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export interface AasConfigOptions {
  // AAS Targeting options
  subscriptionId?: string
  resourceGroup?: string
  aasName?: string
  resourceIds?: string[]

  // Configuration options
  service?: string
  environment?: string
  version?: string
  isInstanceLoggingEnabled?: boolean
  isProfilingEnabled?: boolean
  logPath?: string
  isDotnet?: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  shouldNotRestart?: boolean
}
