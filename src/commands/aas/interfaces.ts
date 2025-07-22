/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export type AasConfigOptions = Partial<{
  // AAS Targeting options
  subscriptionId: string
  resourceGroup: string
  aasName: string
  resourceIds: string[]

  // Configuration options
  service: string
  environment: string
  version: string
  isInstanceLoggingEnabled: boolean
  logPath: string
  envVars: string[]
  isDotnet: boolean
  isMusl: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  shouldNotRestart: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  sourceCodeIntegration: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  uploadGitMetadata: boolean
  extraTags: string
}>
