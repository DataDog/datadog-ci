export const RUNTIME_LAYER_LOOKUP = {
  'nodejs10.x': 'Datadog-Node10-x',
  'nodejs12.x': 'Datadog-Node12-x',
  'nodejs14.x': 'Datadog-Node14-x',
  'python2.7': 'Datadog-Python27',
  'python3.6': 'Datadog-Python36',
  'python3.7': 'Datadog-Python37',
  'python3.8': 'Datadog-Python38',
  'python3.9': 'Datadog-Python39',
} as const
export type Runtime = keyof typeof RUNTIME_LAYER_LOOKUP

const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'
export const HANDLER_LOCATION = {
  'nodejs10.x': NODE_HANDLER_LOCATION,
  'nodejs12.x': NODE_HANDLER_LOCATION,
  'nodejs14.x': NODE_HANDLER_LOCATION,
  'python2.7': PYTHON_HANDLER_LOCATION,
  'python3.6': PYTHON_HANDLER_LOCATION,
  'python3.7': PYTHON_HANDLER_LOCATION,
  'python3.8': PYTHON_HANDLER_LOCATION,
  'python3.9': PYTHON_HANDLER_LOCATION,
}

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const GOVCLOUD_LAYER_AWS_ACCOUNT = '002406178527'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'
export const TAG_VERSION_NAME = 'dd_sls_ci'
export const DD_LAMBDA_EXTENSION_LAYER_NAME = 'Datadog-Extension'

// Environment variables used in the Lambda environment
export const API_KEY_ENV_VAR = 'DD_API_KEY'
export const KMS_API_KEY_ENV_VAR = 'DD_KMS_API_KEY'
export const SITE_ENV_VAR = 'DD_SITE'
export const TRACE_ENABLED_ENV_VAR = 'DD_TRACE_ENABLED'
export const MERGE_XRAY_TRACES_ENV_VAR = 'DD_MERGE_XRAY_TRACES'
export const FLUSH_TO_LOG_ENV_VAR = 'DD_FLUSH_TO_LOG'
export const LOG_LEVEL_ENV_VAR = 'DD_LOG_LEVEL'
export const LAMBDA_HANDLER_ENV_VAR = 'DD_LAMBDA_HANDLER'

// Environment variables used by Datadog CI
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_KMS_API_KEY_ENV_VAR = 'DATADOG_KMS_API_KEY'
