import {EnvironmentVar} from '@azure/arm-appcontainers'
import {AasConfigOptions} from '@datadog/datadog-ci-base/commands/aas/common'
import {getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless'

export const DD_API_KEY_SECRET_NAME = 'dd-api-key'

export const getEnvVarsByName = (
  config: AasConfigOptions,
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

  return envVars
}
