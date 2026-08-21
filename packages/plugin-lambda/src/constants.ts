import type {Runtime} from '@aws-sdk/client-lambda'

import {
  DD_LOG_LEVEL_ENV_VAR,
  DD_TAGS_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  FLARE_PROJECT_FILES,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {LAMBDA_LAYER_CATALOG} from '@datadog/datadog-ci-base/helpers/serverless/lambda-layer-catalog'
import {AdaptiveRetryStrategy, ConfiguredRetryStrategy} from '@smithy/util-retry'

export const LAMBDA_FIPS_ENV_VAR = 'DATADOG_LAMBDA_FIPS'

export const EXTENSION_LAYER_KEY = 'extension'

type LayerKey = {
  [RuntimeKey in keyof typeof LAMBDA_LAYER_CATALOG.runtimes]: 'layers' extends keyof (typeof LAMBDA_LAYER_CATALOG.runtimes)[RuntimeKey]
    ? RuntimeKey
    : never
}[keyof typeof LAMBDA_LAYER_CATALOG.runtimes]

export const LAYER_LOOKUP = Object.fromEntries(
  Object.entries(LAMBDA_LAYER_CATALOG.runtimes).flatMap(([runtime, config]) =>
    'layers' in config ? [[runtime, config.layers.x86_64]] : []
  )
) as Record<LayerKey, string>

export const DD_LAMBDA_EXTENSION_LAYER_NAME = LAYER_LOOKUP[EXTENSION_LAYER_KEY]

export enum RuntimeType {
  DOTNET = 'dotnet',
  CUSTOM = 'custom',
  JAVA = 'java',
  NODE = 'node',
  PYTHON = 'python',
  RUBY = 'ruby',
}

// Lookup table for runtimes that are currently supported by the CLI
export const RUNTIME_LOOKUP = Object.fromEntries(
  Object.entries(LAMBDA_LAYER_CATALOG.runtimes).flatMap(([runtime, config]) =>
    'family' in config ? [[runtime, config.family]] : []
  )
) as Partial<Record<Runtime, RuntimeType>>

export type {LayerKey}
export const ARM_LAYERS = Object.entries(LAMBDA_LAYER_CATALOG.runtimes).flatMap(([runtime, config]) =>
  'layers' in config && config.layers.arm64 !== config.layers.x86_64 ? [runtime] : []
) as LayerKey[]
export const ARM64_ARCHITECTURE = 'arm64'
export const ARM_LAYER_SUFFIX = '-ARM'

export const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
export const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const GOVCLOUD_LAYER_AWS_ACCOUNT = '002406178527'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'

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
export const API_KEY_SSM_ARN_ENV_VAR = 'DD_API_KEY_SSM_ARN'
export const KMS_API_KEY_ENV_VAR = 'DD_KMS_API_KEY'
export const MERGE_XRAY_TRACES_ENV_VAR = 'DD_MERGE_XRAY_TRACES'
export const FLUSH_TO_LOG_ENV_VAR = 'DD_FLUSH_TO_LOG'
export const LOG_ENABLED_ENV_VAR = 'DD_SERVERLESS_LOGS_ENABLED'
export const LAMBDA_HANDLER_ENV_VAR = 'DD_LAMBDA_HANDLER'
export const CAPTURE_LAMBDA_PAYLOAD_ENV_VAR = 'DD_CAPTURE_LAMBDA_PAYLOAD'
export const APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR = 'DD_APM_FLUSH_DEADLINE_MILLISECONDS'
export const APPSEC_ENABLED_ENV_VAR = 'DD_APPSEC_ENABLED'
export const SERVERLESS_APPSEC_ENABLED_ENV_VAR = 'DD_SERVERLESS_APPSEC_ENABLED'
export const ENABLE_PROFILING_ENV_VAR = 'CORECLR_ENABLE_PROFILING'
export const PROFILER_ENV_VAR = 'CORECLR_PROFILER'
export const PROFILER_PATH_ENV_VAR = 'CORECLR_PROFILER_PATH'
export const DOTNET_TRACER_HOME_ENV_VAR = 'DD_DOTNET_TRACER_HOME'
export const DD_LAMBDA_FIPS_MODE_ENV_VAR = 'DD_LAMBDA_FIPS_MODE'

// Environment variables used by Datadog CI
export const CI_API_KEY_SECRET_ARN_ENV_VAR = 'DATADOG_API_KEY_SECRET_ARN'
export const CI_API_KEY_SSM_ARN_ENV_VAR = 'DATADOG_API_KEY_SSM_ARN'
export const CI_KMS_API_KEY_ENV_VAR = 'DATADOG_KMS_API_KEY'

export const AWS_ACCESS_KEY_ID_ENV_VAR = 'AWS_ACCESS_KEY_ID'
export const AWS_SECRET_ACCESS_KEY_ENV_VAR = 'AWS_SECRET_ACCESS_KEY'
export const AWS_DEFAULT_REGION_ENV_VAR = 'AWS_DEFAULT_REGION'
export const AWS_SESSION_TOKEN_ENV_VAR = 'AWS_SESSION_TOKEN'
export const AWS_SHARED_CREDENTIALS_FILE_ENV_VAR = 'AWS_SHARED_CREDENTIALS_FILE'

export const AWS_ACCESS_KEY_ID_REG_EXP = /(?<![A-Z0-9])[A-Z0-9]{20}(?![A-Z0-9])/g
export const AWS_SECRET_ACCESS_KEY_REG_EXP = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g
export const AWS_SECRET_ARN_REG_EXP = /arn:aws:secretsmanager:[\w-]+:\d{12}:secret:.+/
export const AWS_SSM_ARN_REG_EXP = /arn:aws:ssm:[\w-]+:\d{12}:parameter\/.+/
export const DATADOG_API_KEY_REG_EXP = /(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g
export const DATADOG_APP_KEY_REG_EXP = /(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])/g

// Environment Variables whose values don't need to be masked
export const SKIP_MASKING_LAMBDA_ENV_VARS = new Set([
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  API_KEY_SSM_ARN_ENV_VAR,
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

// Adaptive retry strategy trades off latency for a higher likelihood of succeeding
// by dynamically adjusting request rates based on throttling responses. We'll allow a max of 3 attempts.
export const ADAPTIVE_RETRY_STRATEGY = new AdaptiveRetryStrategy(() => Promise.resolve(3))
