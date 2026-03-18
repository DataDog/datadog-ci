// Defines the "clean" (uninstrumented) state of Container Apps used for e2e tests.
// Deployed before each test run to reset the apps to a known baseline.

param location string = resourceGroup().location
param containerAppNamePrefix string

var logAnalyticsName = '${containerAppNamePrefix}-logs'
var environmentName = '${containerAppNamePrefix}-env'
var nodeVersions = [20, 22, 24]

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApps 'Microsoft.App/containerApps@2024-03-01' = [
  for nodeVersion in nodeVersions: {
    name: '${containerAppNamePrefix}-node-${nodeVersion}'
    location: location
    properties: {
      managedEnvironmentId: environment.id
      configuration: {
        ingress: {
          external: true
          targetPort: 80
        }
      }
      template: {
        containers: [
          {
            name: 'hello-world'
            image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
            resources: {
              cpu: json('0.25')
              memory: '0.5Gi'
            }
          }
        ]
        scale: {
          minReplicas: 0
          maxReplicas: 1
        }
      }
    }
  }
]
