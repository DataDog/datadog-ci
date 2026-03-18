# Container App E2E Test Infrastructure

The CI e2e tests create ephemeral container apps per run and delete them afterward.
The only prerequisite is a shared Container App Environment (and its Log Analytics Workspace),
which is provisioned once via the Bicep template.

## Resources (provisioned once)

- **Log Analytics Workspace** - required by the Container App Environment
- **Container App Environment** - hosting environment for ephemeral apps

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

Then configure OIDC federated identity credentials for GitHub Actions
(see the Datadog SECENG guide for details).

### 3. Deploy the environment

```bash
az deployment group create \
  --resource-group datadog-ci-e2e \
  --template-file main.bicep \
  --parameters environmentName=dd-ci-e2e-capp-env
```

### 4. Add GitHub Actions secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID_E2E` | Service principal `appId` |
| `AZURE_TENANT_ID_E2E` | Azure `tenant` |
| `AZURE_SUBSCRIPTION_ID_E2E` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP_E2E` | Resource group name (e.g. `datadog-ci-e2e`) |
| `AZURE_CONTAINER_APP_ENV_E2E` | Environment name (e.g. `dd-ci-e2e-capp-env`) |
