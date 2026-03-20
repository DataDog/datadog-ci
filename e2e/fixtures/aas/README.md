# AAS E2E Test Infrastructure

CI creates ephemeral App Service web apps per run and deletes them afterward. The only prerequisites are pre-provisioned App Service Plans (one Linux, one Windows).

## Setup

### 1. Create App Service Plans

```bash
az appservice plan create --name dd-ci-e2e-aas-linux-plan --resource-group datadog-ci-e2e --is-linux --sku B1
az appservice plan create --name dd-ci-e2e-aas-windows-plan --resource-group datadog-ci-e2e --sku B1
```

### 2. Add GitHub Actions variables

| Variable | Value |
|----------|-------|
| `AZURE_AAS_LINUX_PLAN_E2E` | `dd-ci-e2e-aas-linux-plan` |
| `AZURE_AAS_WINDOWS_PLAN_E2E` | `dd-ci-e2e-aas-windows-plan` |

OIDC credentials (`AZURE_CLIENT_ID_E2E`, `AZURE_TENANT_ID_E2E`, `AZURE_SUBSCRIPTION_ID_E2E`) and resource group (`AZURE_RESOURCE_GROUP_E2E`) are already configured from the container-app setup.
