# Container App E2E Test Infrastructure

Bicep template that defines the "clean" (uninstrumented) state of an Azure Container App used by the CI e2e tests. Deployed before each test run to reset the app to a known baseline.

## Resources

- **Log Analytics Workspace** - required by the Container App Environment
- **Container App Environment** - hosting environment
- **Container App** - minimal hello-world container (`mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`)

## Initial Setup

### 1. Create a resource group

```bash
az group create --name datadog-ci-e2e --location eastus
```

### 2. Create a service principal

```bash
az ad sp create-for-rbac \
  --name datadog-ci-e2e-sp \
  --role Contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/datadog-ci-e2e
```

Save the output — you'll need `appId`, `password`, and `tenant`.

### 3. Deploy the template (first time)

```bash
az deployment group create \
  --resource-group datadog-ci-e2e \
  --template-file main.bicep \
  --parameters containerAppName=datadog-ci-e2e-app
```

### 4. Add GitHub Actions secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID_E2E` | Service principal `appId` |
| `AZURE_CLIENT_SECRET_E2E` | Service principal `password` |
| `AZURE_TENANT_ID_E2E` | Azure `tenant` |
| `AZURE_SUBSCRIPTION_ID_E2E` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP_E2E` | Resource group name (e.g. `datadog-ci-e2e`) |
| `AZURE_CONTAINER_APP_NAME_E2E` | Container app name (e.g. `datadog-ci-e2e-app`) |
