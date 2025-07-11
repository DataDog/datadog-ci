export const DATADOG_SITE_US1 = 'datadoghq.com'
export const DATADOG_SITE_EU1 = 'datadoghq.eu'
export const DATADOG_SITE_US3 = 'us3.datadoghq.com'
export const DATADOG_SITE_US5 = 'us5.datadoghq.com'
export const DATADOG_SITE_AP1 = 'ap1.datadoghq.com'
export const DATADOG_SITE_AP2 = 'ap2.datadoghq.com'
export const DATADOG_SITE_GOV = 'ddog-gov.com'

export const DATADOG_SITES: string[] = [
  DATADOG_SITE_US1,
  DATADOG_SITE_EU1,
  DATADOG_SITE_US3,
  DATADOG_SITE_US5,
  DATADOG_SITE_AP1,
  DATADOG_SITE_AP2,
  DATADOG_SITE_GOV,
]

// Common env vars
export const FIPS_ENV_VAR = 'DATADOG_FIPS'
export const FIPS_IGNORE_ERROR_ENV_VAR = 'DATADOG_FIPS_IGNORE_ERROR'

export const LAMBDA_FIPS_ENV_VAR = 'DATADOG_LAMBDA_FIPS'

export const CONTENT_TYPE_HEADER = 'Content-Type'
export const CONTENT_TYPE_VALUE_PROTOBUF = 'application/x-protobuf'
export const CONTENT_TYPE_VALUE_JSON = 'application/json'

export const METHOD_POST = 'post'

// Tagging env vars
export const SERVICE_ENV_VAR = 'DD_SERVICE'
export const ENVIRONMENT_ENV_VAR = 'DD_ENV'
export const VERSION_ENV_VAR = 'DD_VERSION'

// Environment variables for Lambda and Cloud Run
export const API_KEY_ENV_VAR = 'DD_API_KEY'
export const CI_API_KEY_ENV_VAR = 'DATADOG_API_KEY'
export const CI_SITE_ENV_VAR = 'DATADOG_SITE'
export const SITE_ENV_VAR = 'DD_SITE'
export const LOGS_INJECTION_ENV_VAR = 'DD_LOGS_INJECTION'
export const LOGS_PATH_ENV_VAR = 'DD_SERVERLESS_LOG_PATH'
export const HEALTH_PORT_ENV_VAR = 'DD_HEALTH_PORT'
export const DD_LOG_LEVEL_ENV_VAR = 'DD_LOG_LEVEL'
export const DD_TRACE_ENABLED_ENV_VAR = 'DD_TRACE_ENABLED'
export const DD_LLMOBS_ENABLED_ENV_VAR = 'DD_LLMOBS_ENABLED'
export const DD_LLMOBS_ML_APP_ENV_VAR = 'DD_LLMOBS_ML_APP'
export const DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR = 'DD_LLMOBS_AGENTLESS_ENABLED'
export const DD_TAGS_ENV_VAR = 'DD_TAGS'
/*
 * DD_TAGS Regular Expression
 * This RegExp ensures that the --extra-tags string
 * matches a list of <key>:<value> separated by commas
 * such as layer:api,team:intake
 */
export const EXTRA_TAGS_REG_EXP = /^(([a-zA-Z]+)[\w\-/\.]*:[^,]+)+((\,)([a-zA-Z]+)[\w\-/\.]*:[^,]+)*$/g

// Flare constants
export const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
export const LOGS_DIRECTORY = 'logs'
export const PROJECT_FILES_DIRECTORY = 'project_files'
export const ADDITIONAL_FILES_DIRECTORY = 'additional_files'
export const INSIGHTS_FILE_NAME = 'INSIGHTS.md'
export const FLARE_ENDPOINT_PATH = '/api/ui/support/serverless/flare'

// Project files to search for in Flare
export const FLARE_PROJECT_FILES = [
  // Datadog CloudFormation Template
  'datadog-cloudfomation-macro.yaml',
  'datadog-cloudfomation-macro.yml',
  'datadog-cloudformation-macro.json',
  // Node.js
  'package.json',
  'package-lock.json',
  'yarn.lock',
  '.nvmrc',
  // Python
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'pyproject.toml',
  // Java
  'pom.xml',
  'build.gradle',
  'gradlew',
  'gradlew.bat',
  // Go
  'Makefile',
  'go.mod',
  'go.sum',
  'Gopkg.toml',
  'gomod.sh',
  // Ruby
  'Gemfile',
  'Gemfile.lock',
  // .NET
  'project.json',
  'packages.config',
  'PackageReference',
  'global.json',
  // Docker
  'Dockerfile',
  'docker-compose.yaml',
  'docker-compose.yml',
  // Webpack, bundlers
  'webpack.config.js',
  '.babelrc',
  'tsconfig.json',
  'esbuild.config.js',
]
