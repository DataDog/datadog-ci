export const DATADOG_SITE_US1 = 'datadoghq.com'
export const DATADOG_SITE_EU1 = 'datadoghq.eu'
export const DATADOG_SITE_US3 = 'us3.datadoghq.com'
export const DATADOG_SITE_US5 = 'us5.datadoghq.com'
export const DATADOG_SITE_AP1 = 'ap1.datadoghq.com'
export const DATADOG_SITE_GOV = 'ddog-gov.com'

export const DATADOG_SITES: string[] = [
  DATADOG_SITE_US1,
  DATADOG_SITE_EU1,
  DATADOG_SITE_US3,
  DATADOG_SITE_US5,
  DATADOG_SITE_AP1,
  DATADOG_SITE_GOV,
]

// Tagging env vars
export const SERVICE_ENV_VAR = 'DD_SERVICE'
export const ENVIRONMENT_ENV_VAR = 'DD_ENV'
export const VERSION_ENV_VAR = 'DD_VERSION'

// Environment variables for Lambda and Cloud Run
export const API_KEY_ENV_VAR = 'DD_API_KEY'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const SITE_ENV_VAR = 'DD_SITE'

// Flare constants
export const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
export const LOGS_DIRECTORY = 'logs'
export const PROJECT_FILES_DIRECTORY = 'project_files'
export const ADDITIONAL_FILES_DIRECTORY = 'additional_files'
export const FLARE_ENDPOINT_PATH = '/api/ui/support/serverless/flare'
