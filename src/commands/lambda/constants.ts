export const DD_LAMBDA_EXTENSION_LAYER_NAME = 'Datadog-Extension'
export const EXTENSION_LAYER_KEY = 'extension'
export const RUNTIME_LAYER_LOOKUP = {
  [EXTENSION_LAYER_KEY]: DD_LAMBDA_EXTENSION_LAYER_NAME,
  'nodejs12.x': 'Datadog-Node12-x',
  'nodejs14.x': 'Datadog-Node14-x',
  'python3.6': 'Datadog-Python36',
  'python3.7': 'Datadog-Python37',
  'python3.8': 'Datadog-Python38',
  'python3.9': 'Datadog-Python39',
} as const
// We exclude the Extension Layer Key in order for the runtime
// to be used directly in HANDLER_LOCATION.
export type Runtime = Exclude<keyof typeof RUNTIME_LAYER_LOOKUP, typeof EXTENSION_LAYER_KEY>

export const ARM_RUNTIMES = [EXTENSION_LAYER_KEY, 'python3.8', 'python3.9']
export const ARM64_ARCHITECTURE = 'arm64'
export const ARM_LAYER_SUFFIX = '-ARM'

export enum RuntimeType {
  NODE,
  PYTHON,
}

export const RUNTIME_LOOKUP: {[key: string]: RuntimeType} = {
  'nodejs12.x': RuntimeType.NODE,
  'nodejs14.x': RuntimeType.NODE,
  'python3.6': RuntimeType.PYTHON,
  'python3.7': RuntimeType.PYTHON,
  'python3.8': RuntimeType.PYTHON,
  'python3.9': RuntimeType.PYTHON,
}

const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'
export const HANDLER_LOCATION = {
  'nodejs12.x': NODE_HANDLER_LOCATION,
  'nodejs14.x': NODE_HANDLER_LOCATION,
  'python3.6': PYTHON_HANDLER_LOCATION,
  'python3.7': PYTHON_HANDLER_LOCATION,
  'python3.8': PYTHON_HANDLER_LOCATION,
  'python3.9': PYTHON_HANDLER_LOCATION,
}

export const SITES: string[] = [
  'datadoghq.com',
  'datadoghq.eu',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
  'ddog-gov.,com',
]

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const GOVCLOUD_LAYER_AWS_ACCOUNT = '002406178527'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'
export const TAG_VERSION_NAME = 'dd_sls_ci'

// Environment variables used in the Lambda environment
export const API_KEY_ENV_VAR = 'DD_API_KEY'
export const API_KEY_SECRET_ARN_ENV_VAR = 'DD_API_KEY_SECRET_ARN'
export const KMS_API_KEY_ENV_VAR = 'DD_KMS_API_KEY'
export const SITE_ENV_VAR = 'DD_SITE'
export const TRACE_ENABLED_ENV_VAR = 'DD_TRACE_ENABLED'
export const MERGE_XRAY_TRACES_ENV_VAR = 'DD_MERGE_XRAY_TRACES'
export const FLUSH_TO_LOG_ENV_VAR = 'DD_FLUSH_TO_LOG'
export const LOG_LEVEL_ENV_VAR = 'DD_LOG_LEVEL'
export const LAMBDA_HANDLER_ENV_VAR = 'DD_LAMBDA_HANDLER'
export const SERVICE_ENV_VAR = 'DD_SERVICE'
export const VERSION_ENV_VAR = 'DD_VERSION'
export const ENVIRONMENT_ENV_VAR = 'DD_ENV'
export const EXTRA_TAGS_ENV_VAR = 'DD_TAGS'

// Environment variables used by Datadog CI
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_API_KEY_SECRET_ARN_ENV_VAR = 'DATADOG_API_KEY_SECRET_ARN'
export const CI_KMS_API_KEY_ENV_VAR = 'DATADOG_KMS_API_KEY'

export const LIST_FUNCTIONS_MAX_RETRY_COUNT = 2
export const MAX_LAMBDA_STATE_CHECK_ATTEMPTS = 3

// DD_TAGS Regular Expression
// This RegExp ensures that the --extra-tags string
// matches a list of <key>:<value> separated by commas
// such as: layer:api,team:intake
export const EXTRA_TAGS_REG_EXP: RegExp = /^(([a-zA-Z]+)\w+:[\w\-/\.]+)+((\,)([a-zA-Z]+)\w+:[\w\-/\.]+)*$/g
