import type {ContainerApp, EnvironmentVar} from '@azure/arm-appcontainers'
import type {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'

import {getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {DD_SOURCE_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'

export const DD_API_KEY_SECRET_NAME = 'dd-api-key'

export const redactSecrets = (containerApp: ContainerApp): ContainerApp => ({
  ...containerApp,
  configuration: {
    ...containerApp.configuration,
    secrets: containerApp.configuration?.secrets?.map((secret) =>
      secret.value === undefined ? secret : {...secret, value: '<redacted>'}
    ),
  },
})

export const getEnvVarsByName = (
  config: ContainerAppConfigOptions,
  subscriptionId: string,
  resourceGroup: string
): Record<string, EnvironmentVar> => {
  // Get base environment variables
  const envVars: Record<string, EnvironmentVar> = Object.fromEntries(
    Object.entries(getBaseEnvVars(config)).map(([name, value]) => [name, {name, value}])
  )

  // special case for DD_API_KEY where we use a secret
  delete envVars.DD_API_KEY.value
  envVars.DD_API_KEY.secretRef = DD_API_KEY_SECRET_NAME

  envVars.DD_AZURE_SUBSCRIPTION_ID = {name: 'DD_AZURE_SUBSCRIPTION_ID', value: subscriptionId}
  envVars.DD_AZURE_RESOURCE_GROUP = {name: 'DD_AZURE_RESOURCE_GROUP', value: resourceGroup}
  envVars.DD_SERVERLESS_LOG_PATH = {name: 'DD_SERVERLESS_LOG_PATH', value: config.logsPath}
  envVars.DD_APM_ENABLED = {name: 'DD_APM_ENABLED', value: 'true'}
  if (config.language) {
    envVars[DD_SOURCE_ENV_VAR] = {name: DD_SOURCE_ENV_VAR, value: config.language}
  }

  return envVars
}
