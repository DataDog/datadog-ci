import {ContainerApp} from '@azure/arm-appcontainers'
import {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
import {
  DEFAULT_LOGS_PATH,
  DEFAULT_VOLUME_PATH,
  DEFAULT_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'

export const DEFAULT_CONFIG: ContainerAppConfigOptions = {
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  resourceGroup: 'my-resource-group',
  containerAppName: 'my-container-app',
  service: undefined,
  environment: undefined,
  version: undefined,
  logsPath: DEFAULT_LOGS_PATH,
  sharedVolumeName: DEFAULT_VOLUME_NAME,
  sharedVolumePath: DEFAULT_VOLUME_PATH,
  envVars: undefined,
  sourceCodeIntegration: true,
  uploadGitMetadata: true,
  extraTags: undefined,
}

export const NULL_SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000'

export const CONTAINER_APP_ID =
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.App/containerApps/my-container-app'

export const DEFAULT_CONTAINER_APP: ContainerApp = {
  id: CONTAINER_APP_ID,
  name: 'my-container-app',
  location: 'East US',
  type: 'Microsoft.App/containerApps',
  template: {
    containers: [
      {
        name: 'main-container',
        image: 'myregistry.azurecr.io/myapp:latest',
        resources: {
          cpu: 0.5,
          memory: '1Gi',
        },
        env: [
          {
            name: 'PORT',
            value: '8080',
          },
        ],
      },
    ],
    scale: {
      minReplicas: 1,
      maxReplicas: 10,
    },
  },
}

export const DEFAULT_ARGS = [
  '-s',
  '00000000-0000-0000-0000-000000000000',
  '-g',
  'my-resource-group',
  '-n',
  'my-container-app',
]
export const DEFAULT_INSTRUMENT_ARGS = [...DEFAULT_ARGS, '--no-source-code-integration']
