import type {Runtime} from '@aws-sdk/client-lambda'

import {
  DD_LOG_LEVEL_ENV_VAR,
  DD_TAGS_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  FLARE_PROJECT_FILES,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/constants'
import {ConfiguredRetryStrategy} from '@smithy/util-retry'

export const LAMBDA_FIPS_ENV_VAR = 'DATADOG_LAMBDA_FIPS'

export const DD_LAMBDA_EXTENSION_LAYER_NAME = 'Datadog-Extension'
export const EXTENSION_LAYER_KEY = 'extension'
export const LAYER_LOOKUP = {
  [EXTENSION_LAYER_KEY]: DD_LAMBDA_EXTENSION_LAYER_NAME,
  dotnet6: 'dd-trace-dotnet',
  dotnet8: 'dd-trace-dotnet',
  java11: 'dd-trace-java',
  java17: 'dd-trace-java',
  java21: 'dd-trace-java',
  'java8.al2': 'dd-trace-java',
  'nodejs16.x': 'Datadog-Node16-x',
  'nodejs18.x': 'Datadog-Node18-x',
  'nodejs20.x': 'Datadog-Node20-x',
  'nodejs22.x': 'Datadog-Node22-x',
  'python3.8': 'Datadog-Python38',
  'python3.9': 'Datadog-Python39',
  'python3.10': 'Datadog-Python310',
  'python3.11': 'Datadog-Python311',
  'python3.12': 'Datadog-Python312',
  'python3.13': 'Datadog-Python313',
  'ruby3.2': 'Datadog-Ruby3-2',
  'ruby3.3': 'Datadog-Ruby3-3',
} as const

export enum RuntimeType {
  DOTNET,
  CUSTOM,
  JAVA,
  NODE,
  PYTHON,
  RUBY,
}

// Lookup table for runtimes that are currently supported by the CLI
export const RUNTIME_LOOKUP: Partial<Record<Runtime, RuntimeType>> = {
  dotnet6: RuntimeType.DOTNET,
  dotnet8: RuntimeType.DOTNET,
  java11: RuntimeType.JAVA,
  java17: RuntimeType.JAVA,
  java21: RuntimeType.JAVA,
  'java8.al2': RuntimeType.JAVA,
  'nodejs16.x': RuntimeType.NODE,
  'nodejs18.x': RuntimeType.NODE,
  'nodejs20.x': RuntimeType.NODE,
  'nodejs22.x': RuntimeType.NODE,
  'provided.al2': RuntimeType.CUSTOM,
  'provided.al2023': RuntimeType.CUSTOM,
  'python3.8': RuntimeType.PYTHON,
  'python3.9': RuntimeType.PYTHON,
  'python3.10': RuntimeType.PYTHON,
  'python3.11': RuntimeType.PYTHON,
  'python3.12': RuntimeType.PYTHON,
  'python3.13': RuntimeType.PYTHON,
  'ruby3.2': RuntimeType.RUBY,
  'ruby3.3': RuntimeType.RUBY,
}

export type LayerKey = keyof typeof LAYER_LOOKUP
export const ARM_LAYERS = [
  EXTENSION_LAYER_KEY,
  'dotnet6',
  'dotnet8',
  'python3.8',
  'python3.9',
  'python3.10',
  'python3.11',
  'python3.12',
  'python3.13',
  'ruby3.2',
  'ruby3.3',
]
export const ARM64_ARCHITECTURE = 'arm64'
export const ARM_LAYER_SUFFIX = '-ARM'

export const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
export const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const GOVCLOUD_LAYER_AWS_ACCOUNT = '002406178527'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'
export const TAG_VERSION_NAME = 'dd_sls_ci'

// Env variables for Univeral instrument lambda exec wrapper
export const AWS_LAMBDA_EXEC_WRAPPER_VAR = 'AWS_LAMBDA_EXEC_WRAPPER'
export const AWS_LAMBDA_EXEC_WRAPPER = '/opt/datadog_wrapper'

// Export const values for .NET tracer
export const CORECLR_ENABLE_PROFILING = '1'
export const CORECLR_PROFILER = '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'
export const CORECLR_PROFILER_PATH = '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so'
export const DD_DOTNET_TRACER_HOME = '/opt/datadog'

// Environment variables used in the Lambda environment
export const API_KEY_SECRET_ARN_ENV_VAR = 'DD_API_KEY_SECRET_ARN'
export const KMS_API_KEY_ENV_VAR = 'DD_KMS_API_KEY'
export const MERGE_XRAY_TRACES_ENV_VAR = 'DD_MERGE_XRAY_TRACES'
export const FLUSH_TO_LOG_ENV_VAR = 'DD_FLUSH_TO_LOG'
export const LOG_ENABLED_ENV_VAR = 'DD_SERVERLESS_LOGS_ENABLED'
export const LAMBDA_HANDLER_ENV_VAR = 'DD_LAMBDA_HANDLER'
export const CAPTURE_LAMBDA_PAYLOAD_ENV_VAR = 'DD_CAPTURE_LAMBDA_PAYLOAD'
export const APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR = 'DD_APM_FLUSH_DEADLINE_MILLISECONDS'
export const APPSEC_ENABLED_ENV_VAR = 'DD_SERVERLESS_APPSEC_ENABLED'
export const ENABLE_PROFILING_ENV_VAR = 'CORECLR_ENABLE_PROFILING'
export const PROFILER_ENV_VAR = 'CORECLR_PROFILER'
export const PROFILER_PATH_ENV_VAR = 'CORECLR_PROFILER_PATH'
export const DOTNET_TRACER_HOME_ENV_VAR = 'DD_DOTNET_TRACER_HOME'
export const DD_LAMBDA_FIPS_MODE_ENV_VAR = 'DD_LAMBDA_FIPS_MODE'

// Environment variables used by Datadog CI
export const CI_API_KEY_SECRET_ARN_ENV_VAR = 'DATADOG_API_KEY_SECRET_ARN'
export const CI_KMS_API_KEY_ENV_VAR = 'DATADOG_KMS_API_KEY'

export const AWS_ACCESS_KEY_ID_ENV_VAR = 'AWS_ACCESS_KEY_ID'
export const AWS_SECRET_ACCESS_KEY_ENV_VAR = 'AWS_SECRET_ACCESS_KEY'
export const AWS_DEFAULT_REGION_ENV_VAR = 'AWS_DEFAULT_REGION'
export const AWS_SESSION_TOKEN_ENV_VAR = 'AWS_SESSION_TOKEN'
export const AWS_SHARED_CREDENTIALS_FILE_ENV_VAR = 'AWS_SHARED_CREDENTIALS_FILE'

export const AWS_ACCESS_KEY_ID_REG_EXP = /(?<![A-Z0-9])[A-Z0-9]{20}(?![A-Z0-9])/g
export const AWS_SECRET_ACCESS_KEY_REG_EXP = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g
export const AWS_SECRET_ARN_REG_EXP = /arn:aws:secretsmanager:[\w-]+:\d{12}:secret:.+/
export const DATADOG_API_KEY_REG_EXP = /(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g
export const DATADOG_APP_KEY_REG_EXP = /(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])/g

// Environment Variables whose values don't need to be masked
export const SKIP_MASKING_LAMBDA_ENV_VARS = new Set([
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  DD_LOG_LEVEL_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
])

export enum DeploymentFrameworks {
  ServerlessFramework = 'Serverless Framework',
  AwsCdk = 'AWS CDK',
  AwsCloudFormation = 'AWS CloudFormation',
  Unknown = 'Unknown',
}

// Mappings of files to frameworks.
// For example, if `serverless.yml` exists, we know it's the Serverless Framework
export const FRAMEWORK_FILES_MAPPING = new Map([
  ['serverless.yaml', DeploymentFrameworks.ServerlessFramework],
  ['serverless.yml', DeploymentFrameworks.ServerlessFramework],
  ['serverless.js', DeploymentFrameworks.ServerlessFramework],
  ['cdk.json', DeploymentFrameworks.AwsCdk],
  ['.cdk.json', DeploymentFrameworks.AwsCdk],
  ['template.yaml', DeploymentFrameworks.AwsCloudFormation],
  ['template.yml', DeploymentFrameworks.AwsCloudFormation],
  ['template.json', DeploymentFrameworks.AwsCloudFormation],
])

export const LAMBDA_PROJECT_FILES = [...FLARE_PROJECT_FILES, ...FRAMEWORK_FILES_MAPPING.keys()]

// Configures max number of attempts and exponential backoff function for AWS requests
// First retry is attempt 1
export const EXPONENTIAL_BACKOFF_RETRY_STRATEGY = new ConfiguredRetryStrategy(
  4,
  (attempt: number) => 1000 * 2 ** (attempt - 1)
)
