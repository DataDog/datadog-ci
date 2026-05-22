# Cloud Run E2E Test Infrastructure

CI creates an ephemeral Cloud Run service per run and deletes it afterward. The test deploys the public `us-docker.pkg.dev/cloudrun/container/hello` image.

## Setup

### 1. Enable Google Cloud APIs

Enable Cloud Run, IAM Credentials, Artifact Registry, and Service Usage APIs in the GCP project used for e2e tests.

### 2. Create a service account with OIDC

Create a service account for GitHub Actions and configure a Workload Identity Provider that trusts this repository.

The service account needs permission to deploy, describe, update, and delete Cloud Run services in the e2e project.

### 3. Add GitHub Actions variables

| Variable | Value |
|----------|-------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER_E2E` | Workload Identity Provider resource name |
| `GCP_SERVICE_ACCOUNT_E2E` | Service account email |
| `GCP_PROJECT_ID_E2E` | GCP project ID |
| `GCP_REGION_E2E` | Cloud Run region, for example `us-central1` |

### 4. Run locally

Authenticate with `gcloud auth application-default login`, then create `e2e/.env.local`:

```bash
GCP_PROJECT_ID=<project-id>
GCP_REGION=<region>
DATADOG_CI_COMMAND='yarn launch'
```

Then run:

```bash
yarn jest --config jest.config-e2e.js e2e/cloud-run.test.ts --colors
```
