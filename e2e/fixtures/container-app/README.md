# Container App E2E Test Infrastructure

CI creates ephemeral container apps per run and deletes them afterward. The only prerequisite is a shared Container App Environment, which is provisioned once.

## Setup

### 1. Create a resource group and environment

```bash
az group create --name datadog-ci-e2e --location eastus

az containerapp env create \
  --name dd-ci-e2e-capp-env \
  --resource-group datadog-ci-e2e \
  --location eastus
```

### 2. Create a service principal with OIDC

```bash
az ad sp create-for-rbac \
  --name datadog-ci-e2e-sp \
  --role Contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/datadog-ci-e2e
```

Then configure OIDC federated identity credentials for GitHub Actions (see the Datadog SECENG guide for details).

### 3. Add GitHub Actions secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID_E2E` | Service principal `appId` |
| `AZURE_TENANT_ID_E2E` | Azure `tenant` |
| `AZURE_SUBSCRIPTION_ID_E2E` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP_E2E` | Resource group name (e.g. `datadog-ci-e2e`) |
| `AZURE_CONTAINER_APP_ENV_E2E` | Environment name (e.g. `dd-ci-e2e-capp-env`) |
