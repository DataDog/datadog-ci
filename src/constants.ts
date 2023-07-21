import {
  API_KEY_SECRET_ARN_ENV_VAR,
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from './commands/lambda/constants'

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

export const AWS_DEFAULT_REGION_ENV_VAR = 'AWS_DEFAULT_REGION'

// Flare constants
export const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
export const FLARE_ENDPOINT_PATH = '/api/ui/support/serverless/flare'

// Environment Variables whose values don't need to be masked
export const SKIP_MASKING_ENV_VARS = new Set([
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
])
