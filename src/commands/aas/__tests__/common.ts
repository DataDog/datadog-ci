import {Site} from '@azure/arm-appservice'

import {AasConfigOptions} from '../interfaces'

export const DEFAULT_CONFIG: AasConfigOptions = {
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  resourceGroup: 'my-resource-group',
  aasName: 'my-web-app',
  service: undefined,
  environment: undefined,
  isInstanceLoggingEnabled: false,
  logPath: undefined,
  isDotnet: false,
  shouldNotRestart: false,
}

export const WEB_APP_ID =
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app'

export const CONTAINER_WEB_APP: Site = {
  id: WEB_APP_ID,
  name: 'my-web-app',
  kind: 'app,linux',
  location: 'East US',
  type: 'Microsoft.Web/sites',
  state: 'Running',
  hostNames: ['my-web-app.azurewebsites.net'],
  repositorySiteName: 'my-web-app',
  usageState: 'Normal',
  enabled: true,
  enabledHostNames: ['my-web-app.azurewebsites.net', 'my-web-app.scm.azurewebsites.net'],
  availabilityState: 'Normal',
  serverFarmId:
    '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/serverfarms/my-asp',
  siteConfig: {
    numberOfWorkers: 1,
    linuxFxVersion: 'SITECONTAINERS',
    windowsFxVersion: undefined,
    acrUseManagedIdentityCreds: false,
    alwaysOn: false,
    localMySqlEnabled: false,
    http20Enabled: true,
    functionAppScaleLimit: 0,
    minimumElasticInstanceCount: 0,
  },
  scmSiteAlsoStopped: false,
  clientAffinityEnabled: true,
  clientCertEnabled: false,
  clientCertMode: 'Required',
  ipMode: 'IPv4',
  endToEndEncryptionEnabled: false,
  hostNamesDisabled: false,
  customDomainVerificationId: 'C311F02DCF9463F87DA1F7BD5F93E1E0DF1C9C3AAC1706DA8214AB95CF540DE3',
  outboundIpAddresses: '20.75.146.31,20.75.146.32,20.75.146.33,20.75.146.40,20.75.146.64,20.75.146.65,20.119.8.46',
  possibleOutboundIpAddresses:
    '20.75.146.211,20.75.146.221,20.75.146.228,20.75.146.229,20.75.146.254,20.75.146.255,40.88.199.185,20.75.146.16,20.75.146.17,20.75.146.24,20.75.146.25,20.75.146.30,20.75.146.31,20.75.146.32,20.75.146.33,20.75.146.40,20.75.146.64,20.75.146.65,20.75.149.122,20.75.146.74,40.88.194.183,20.75.146.166,20.75.146.194,20.75.146.195,20.75.147.4,20.75.147.5,20.75.147.18,20.75.147.19,20.75.147.37,20.75.147.65,20.119.8.46',
  containerSize: 0,
  dailyMemoryTimeQuota: 0,
  resourceGroup: 'my-resource-group',
  defaultHostName: 'my-web-app.azurewebsites.net',
  httpsOnly: false,
  redundancyMode: 'None',
  publicNetworkAccess: 'Enabled',
  storageAccountRequired: false,
  keyVaultReferenceIdentity: 'SystemAssigned',
  sku: 'PremiumV2',
}

export const DEFAULT_ARGS = [
  '-s',
  '00000000-0000-0000-0000-000000000000',
  '-g',
  'my-resource-group',
  '-n',
  'my-web-app',
]
