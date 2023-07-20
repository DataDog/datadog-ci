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

// Environment variables for Lambda and Cloud Run
export const API_KEY_ENV_VAR = 'DD_API_KEY'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const SITE_ENV_VAR = 'DD_SITE'

// Flare constants
export const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
export const FLARE_ENDPOINT_PATH = '/api/ui/support/serverless/flare'
export const FLARE_ZIP_FILE_NAME = 'lambda-flare-output.zip'
