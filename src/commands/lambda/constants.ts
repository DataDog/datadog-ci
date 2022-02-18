export const DD_LAMBDA_EXTENSION_LAYER_NAME = 'Datadog-Extension'
export const EXTENSION_LAYER_KEY = 'extension'
export const DOTNET_RUNTIME = 'dotnetcore3.1'
export const LAYER_LOOKUP = {
  [EXTENSION_LAYER_KEY]: DD_LAMBDA_EXTENSION_LAYER_NAME,
  'dotnetcore3.1': 'dd-trace-dotnet',
  'nodejs12.x': 'Datadog-Node12-x',
  'nodejs14.x': 'Datadog-Node14-x',
  'python3.6': 'Datadog-Python36',
  'python3.7': 'Datadog-Python37',
  'python3.8': 'Datadog-Python38',
  'python3.9': 'Datadog-Python39',
} as const

export enum RuntimeType {
  DOTNET,
  CUSTOM,
  JAVA,
  NODE,
  PYTHON,
  RUBY,
}

export const RUNTIME_LOOKUP = {
  'dotnetcore3.1': RuntimeType.DOTNET,
  java11: RuntimeType.JAVA,
  'java8.al2': RuntimeType.JAVA,
  'nodejs12.x': RuntimeType.NODE,
  'nodejs14.x': RuntimeType.NODE,
  'provided.al2': RuntimeType.CUSTOM,
  'python3.6': RuntimeType.PYTHON,
  'python3.7': RuntimeType.PYTHON,
  'python3.8': RuntimeType.PYTHON,
  'python3.9': RuntimeType.PYTHON,
  'ruby2.5': RuntimeType.RUBY,
  'ruby2.7': RuntimeType.RUBY,
}

export type Runtime = keyof typeof RUNTIME_LOOKUP
export type LayerKey = keyof typeof LAYER_LOOKUP
export const ARM_LAYERS = [EXTENSION_LAYER_KEY, 'python3.8', 'python3.9']
export const ARM64_ARCHITECTURE = 'arm64'
export const ARM_LAYER_SUFFIX = '-ARM'

export const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
export const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'

export const SITES: string[] = [
  'datadoghq.com',
  'datadoghq.eu',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
  'ddog-gov.com',
]

export const AWS_REGIONS: string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-north-1',
  'me-south-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1',
]

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const GOVCLOUD_LAYER_AWS_ACCOUNT = '002406178527'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'
export const TAG_VERSION_NAME = 'dd_sls_ci'

// Export const values for .NET tracer
export const CORECLR_ENABLE_PROFILING = '1'
export const CORECLR_PROFILER = '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'
export const CORECLR_PROFILER_PATH = '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so'
export const DD_DOTNET_TRACER_HOME = '/opt/datadog'

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
export const CAPTURE_LAMBDA_PAYLOAD_ENV_VAR = 'DD_CAPTURE_LAMBDA_PAYLOAD'
export const ENABLE_PROFILING_ENV_VAR = 'CORECLR_ENABLE_PROFILING'
export const PROFILER_ENV_VAR = 'CORECLR_PROFILER'
export const PROFILER_PATH_ENV_VAR = 'CORECLR_PROFILER_PATH'
export const DOTNET_TRACER_HOME_ENV_VAR = 'DD_DOTNET_TRACER_HOME'

// Environment variables used by Datadog CI
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_API_KEY_SECRET_ARN_ENV_VAR = 'DATADOG_API_KEY_SECRET_ARN'
export const CI_KMS_API_KEY_ENV_VAR = 'DATADOG_KMS_API_KEY'

export const AWS_ACCESS_KEY_ID_ENV_VAR = 'AWS_ACCESS_KEY_ID'
export const AWS_SECRET_ACCESS_KEY_ENV_VAR = 'AWS_SECRET_ACCESS_KEY'
export const AWS_DEFAULT_REGION_ENV_VAR = 'AWS_DEFAULT_REGION'
export const AWS_SESSION_TOKEN_ENV_VAR = 'AWS_SESSION_TOKEN'

export const LIST_FUNCTIONS_MAX_RETRY_COUNT = 2
export const MAX_LAMBDA_STATE_CHECK_ATTEMPTS = 3

// DD_TAGS Regular Expression
// This RegExp ensures that the --extra-tags string
// matches a list of <key>:<value> separated by commas
// such as: layer:api,team:intake
export const EXTRA_TAGS_REG_EXP: RegExp = /^(([a-zA-Z]+)\w+:[\w\-/\.]+)+((\,)([a-zA-Z]+)\w+:[\w\-/\.]+)*$/g
export const AWS_ACCESS_KEY_ID_REG_EXP: RegExp = /(?<![A-Z0-9])[A-Z0-9]{20}(?![A-Z0-9])/g
export const AWS_SECRET_ACCESS_KEY_REG_EXP: RegExp = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g
export const DATADOG_API_KEY_REG_EXP: RegExp = /(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g
export const DATADOG_APP_KEY_REG_EXP: RegExp = /(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])/g
