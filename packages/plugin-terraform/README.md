# Terraform command

This command lets you upload Terraform runtime artifacts (plan and state JSON files) to the Datadog CI intake endpoint for enhanced cloud-to-code mapping and policy evaluation.

## Usage

```bash
datadog-ci terraform upload [plan|state] <path/to/terraform-file.json> [additional-files...]
```

### Arguments

- `plan` or `state`: The type of Terraform artifact being uploaded
- `<path>`: Path to one or more Terraform JSON files (space-separated)

### Optional arguments

- `--repo-id` (optional): Repository identifier override (e.g., github.com/datadog/my-repo)
- `--dry-run` (default: `false`): Run the command without uploading any data to Datadog
- `--verbose` (default: `false`): Enable verbose logging
- `--skip-git-metadata-upload` (default: `false`): Skip the upload of git metadata

### Environment variables

The following environment variables are required:

- `DD_API_KEY`: the API key to use

Optional environment variables:

- `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site) (default: `datadoghq.com`)
- `DD_GIT_REPOSITORY_URL`: Override for repository URL
- `DD_REPOSITORY_URL`: Alternative override for repository URL

### Examples

```bash
# Upload a single Terraform plan file
datadog-ci terraform upload plan ./terraform-plan.json

# Upload multiple Terraform plan files
datadog-ci terraform upload plan ./plan1.json ./plan2.json ./plan3.json

# Upload multiple plan files using glob expansion
datadog-ci terraform upload plan ./plans/*.json

# Upload a Terraform state file
datadog-ci terraform upload state ./terraform.tfstate

# Upload with manual repo-id override
datadog-ci terraform upload plan ./terraform-plan.json --repo-id "github.com/datadog/my-repo"

# Dry run mode
datadog-ci terraform upload plan ./terraform-plan.json --dry-run

# Upload multiple files with verbose logging
datadog-ci terraform upload plan ./plan1.json ./plan2.json --verbose
```

### Git context resolution

The Git context is resolved in the following order of priority:

1. CI environment variables
2. Current Git repository metadata
3. Override environment variables (`DD_GIT_*` variables)

The repository identifier (`repo_id`) is resolved in this order:

1. `--repo-id` flag value
2. `DD_GIT_REPOSITORY_URL` or `DD_REPOSITORY_URL` environment variable
3. Git metadata from the current repository

## Development

To test locally, run:

```bash
yarn launch terraform upload plan /path/to/terraform-plan.json
```

## Notes

- The command accepts one or more files per invocation. All files must be of the same artifact type (plan or state).
- Files are automatically gzipped before upload.
- The command computes a SHA256 hash of each file's content.
- No client-side validation or filtering of file content is performed (as per RFC requirements).
- Git metadata is synced only once per invocation, even when uploading multiple files.
