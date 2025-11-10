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
export const DD_SOURCE_ENV_VAR = 'DD_SOURCE' // Tagging env vars

export const SERVICE_ENV_VAR = 'DD_SERVICE'
export const ENVIRONMENT_ENV_VAR = 'DD_ENV'
export const VERSION_ENV_VAR = 'DD_VERSION'

/*
 * DD_TAGS Regular Expression
 * This RegExp ensures that the --extra-tags string
 * matches a list of <key>:<value> separated by commas
 * such as layer:api,team:intake
 */
export const EXTRA_TAGS_REG_EXP = /^(([a-zA-Z]+)[\w\-/.]*:[^,]+)+((,)([a-zA-Z]+)[\w\-/.]*:[^,]+)*$/g

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

/**
 * Shared constants for serverless instrumentation
 */
export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = 8126
export const DEFAULT_SIDECAR_NAME = 'datadog-sidecar'
export const DEFAULT_VOLUME_NAME = 'shared-volume'
export const DEFAULT_VOLUME_PATH = '/shared-volume'
export const DEFAULT_LOGS_PATH = '/shared-volume/logs/*.log'
export const DEFAULT_HEALTH_CHECK_PORT = 5555

/**
 * Regular expression for parsing environment variables in KEY=VALUE format
 */
export const ENV_VAR_REGEX = /^([\w.]+)=(.*)$/
