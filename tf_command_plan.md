# Terraform Upload Command - Implementation Plan

## Overview
This document outlines the implementation plan for adding a new `datadog-ci terraform upload` command to support uploading Terraform runtime artifacts (plan and state JSON) to the Datadog CI Intake API.

**Design Decision**: The command accepts a single file path per invocation. Users who need to upload multiple files should invoke the command multiple times (e.g., in a script or CI pipeline loop). This simplifies error handling, provides clearer output, and aligns with the RFC spec which defines a single `iac_file` part per request.

## RFC Reference
- RFC Document: `/Users/vishal.joshi/Downloads/iac_artifact_rfc.md`
- Target Endpoint: `POST /api/v2/ciiac`
- Intake URL: `https://ci-intake.<site>`
- Track Type: `ciiac`

## Command Syntax
```bash
datadog-ci terraform upload [plan|state] <path>
```

### Flags
- `--repo-id <string>` - Optional manual override for repository identifier
- `--dry-run` - Run command without uploading data to Datadog
- `--verbose` - Enable verbose logging
- `--skip-git-metadata-upload` - Skip upload of git metadata (similar to coverage command)

### Examples
```bash
# Upload a Terraform plan file
datadog-ci terraform upload plan ./terraform-plan.json

# Upload a Terraform state file
datadog-ci terraform upload state ./terraform.tfstate

# Upload with manual repo-id override
datadog-ci terraform upload plan ./terraform-plan.json --repo-id "github.com/datadog/my-repo"

# Dry run mode
datadog-ci terraform upload plan ./terraform-plan.json --dry-run

# Upload multiple files (using a loop)
for file in ./plans/*.json; do
  datadog-ci terraform upload plan "$file"
done
```

## Architecture

### Package Structure
Following the existing plugin architecture pattern:

```
packages/
├── base/src/commands/terraform/
│   ├── cli.ts                    # Command registration
│   └── upload.ts                 # Base command class with Clipanion options
└── plugin-terraform/
    ├── src/
    │   ├── commands/
    │   │   └── upload.ts         # Plugin implementation
    │   ├── api.ts                # API helper for multipart upload
    │   ├── interfaces.ts         # TypeScript interfaces
    │   ├── renderer.ts           # Output formatting functions
    │   ├── utils.ts              # Validation and helper functions
    │   └── __tests__/
    │       ├── api.test.ts
    │       ├── upload.test.ts
    │       └── utils.test.ts
    ├── package.json
    └── README.md
```

### Registration Points
1. **Base package** (`packages/base/src/cli.ts`):
   ```typescript
   import {commands as terraformCommands} from './commands/terraform/cli'

   export const commands = {
     // ... existing commands
     'terraform': terraformCommands,
   } satisfies RecordWithKebabCaseKeys
   ```

2. **Base package.json** (`packages/base/package.json`):
   ```json
   {
     "peerDependencies": {
       "@datadog/datadog-ci-plugin-terraform": "workspace:*"
     }
   }
   ```

3. **Root package.json** - Add new plugin package to workspaces (already configured via `packages/*`)

## Implementation Details

### 1. Base Command Class (`packages/base/src/commands/terraform/cli.ts`)

```typescript
import {TerraformUploadCommand} from './upload'

export const commands = [
  TerraformUploadCommand,
]
```

### 2. Base Command Options (`packages/base/src/commands/terraform/upload.ts`)

```typescript
import {Command, Option} from 'clipanion'
import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'
import {BaseCommand} from '../..'

export class TerraformUploadCommand extends BaseCommand {
  public static paths = [['terraform', 'upload']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Upload Terraform plan or state files to Datadog.',
    details: `
      This command uploads Terraform runtime artifacts (plan or state JSON) to Datadog
      for enhanced cloud-to-code mapping and policy evaluation.\n
      See README for details.
    `,
    examples: [
      ['Upload a Terraform plan file', 'datadog-ci terraform upload plan terraform-plan.json'],
      ['Upload a Terraform state file', 'datadog-ci terraform upload state terraform.tfstate'],
      ['Upload with verbose output', 'datadog-ci terraform upload plan terraform-plan.json --verbose'],
      ['Dry run mode', 'datadog-ci terraform upload plan terraform-plan.json --dry-run'],
    ],
  })

  // Artifact type: 'plan' or 'state'
  protected artifactType = Option.String({required: true})

  // File path to upload
  protected filePath = Option.String({required: true})

  // Optional repo ID override
  protected repoId = Option.String('--repo-id', {
    description: 'Repository identifier override (e.g., github.com/datadog/my-repo)',
  })

  // Skip git metadata upload
  protected skipGitMetadataUpload = Option.Boolean('--skip-git-metadata-upload', false, {
    description: 'Skip the upload of git metadata',
  })

  // Verbose logging
  protected verbose = Option.Boolean('--verbose', false, {
    description: 'Enable verbose logging',
  })

  // Dry run mode
  protected dryRun = Option.Boolean('--dry-run', false, {
    description: 'Run the command in dry run mode, without uploading any data to Datadog',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
```

### 3. Plugin Implementation (`packages/plugin-terraform/src/commands/upload.ts`)

Key responsibilities:
- Validate artifact type ('plan' or 'state')
- Validate file path exists and is readable JSON file
- Compute SHA256 hash of file contents
- Extract git/CI metadata using existing helpers
- Handle repo_id resolution (flag → env vars → git metadata)
- Build event envelope according to RFC spec
- Upload file using multipart/form-data
- Handle errors with appropriate retry logic
- Provide dry-run support

```typescript
import os from 'os'
import fs from 'fs'
import {createHash} from 'crypto'
import {TerraformUploadCommand} from '@datadog/datadog-ci-base/commands/terraform/upload'
import {uploadToGitDB} from '@datadog/datadog-ci-base/commands/git-metadata/gitdb'
import {isGitRepo} from '@datadog/datadog-ci-base/commands/git-metadata/library'
import {newSimpleGit} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {getGitMetadata} from '@datadog/datadog-ci-base/helpers/git/format-git-span-data'
import {getUserGitSpanTags} from '@datadog/datadog-ci-base/helpers/user-provided-git'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {getRequestBuilder, timedExecAsync} from '@datadog/datadog-ci-base/helpers/utils'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_BRANCH,
  CI_PIPELINE_ID,
  CI_PROVIDER_NAME,
} from '@datadog/datadog-ci-base/helpers/tags'
import * as simpleGit from 'simple-git'
import chalk from 'chalk'

import {apiConstructor, intakeUrl} from '../api'
import {TerraformArtifactPayload} from '../interfaces'
import {
  validateArtifactType,
  validateFilePath,
  validateJsonStructure,
  computeFileHash,
  resolveRepoId,
} from '../utils'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderSuccessfulUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderSuccessfulGitDBSync,
  renderFailedGitDBSync,
} from '../renderer'

export class PluginCommand extends TerraformUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
  }

  private logger: Logger = new Logger(
    (s: string) => this.context.stdout.write(s),
    LogLevel.INFO
  )

  private git: simpleGit.SimpleGit | undefined = undefined

  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    // Validate artifact type
    if (!validateArtifactType(this.artifactType)) {
      this.context.stderr.write(
        `Invalid artifact type: ${this.artifactType}. Must be 'plan' or 'state'.\n`
      )
      return 1
    }

    // Validate API key
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )
      return 1
    }

    // Initialize git if in a repository
    const isGitRepository = await isGitRepo()
    if (isGitRepository) {
      this.git = await newSimpleGit()
    }

    // Sync git metadata if needed
    if (!this.skipGitMetadataUpload && isGitRepository) {
      await this.syncGitMetadata()
    }

    // Upload terraform artifact
    return await this.uploadTerraformArtifact()
  }

  private async syncGitMetadata() {
    const traceId = require('@datadog/datadog-ci-base/helpers/id')()
    const requestBuilder = getRequestBuilder({
      baseUrl: apiUrl,
      apiKey: this.config.apiKey!,
      headers: new Map([
        ['x-datadog-trace-id', traceId],
        ['x-datadog-parent-id', traceId],
      ]),
    })

    try {
      this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Syncing git metadata...`)
      let elapsed = 0
      if (!this.dryRun) {
        elapsed = await timedExecAsync(
          () => uploadToGitDB(this.logger, requestBuilder, this.git!, this.dryRun),
          {}
        )
      }
      this.logger.info(renderSuccessfulGitDBSync(this.dryRun, elapsed))
    } catch (err) {
      this.logger.info(renderFailedGitDBSync(err))
    }
  }

  private async uploadTerraformArtifact(): Promise<number> {
    this.logger.info(renderCommandInfo(this.artifactType, this.filePath, this.dryRun))

    // Validate file exists and is readable
    if (!validateFilePath(this.filePath)) {
      this.context.stderr.write(renderInvalidFile(this.filePath, 'File not found or not readable'))
      return 1
    }

    // Read and validate JSON structure
    const fileContent = fs.readFileSync(this.filePath, 'utf8')
    if (!validateJsonStructure(fileContent)) {
      this.context.stderr.write(renderInvalidFile(this.filePath, 'Invalid JSON structure'))
      return 1
    }

    // Compute file hash and size
    const artifactSha256 = computeFileHash(fileContent)
    const artifactSizeBytes = Buffer.byteLength(fileContent, 'utf8')

    const spanTags = await this.getSpanTags()
    const api = apiConstructor(intakeUrl, this.config.apiKey!)

    // Build payload
    const payload: TerraformArtifactPayload = {
      artifactType: this.artifactType,
      filePath: this.filePath,
      fileContent,
      artifactSha256,
      artifactSizeBytes,
      spanTags,
      repoId: resolveRepoId(this.repoId, spanTags),
    }

    try {
      // Upload
      if (this.dryRun) {
        this.logger.info(renderDryRunUpload(payload))
      } else {
        await retryRequest(() => api.uploadTerraformArtifact(payload), {
          onRetry: (e, attempt) => {
            this.logger.warn(`Retry attempt ${attempt} for ${this.filePath}: ${e.message}`)
          },
          retries: 5,
        })
        this.logger.info(renderSuccessfulUpload(this.filePath))
      }

      return 0
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(this.filePath, error))
      return 1
    }
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
    }
  }
}
```

### 4. API Helper (`packages/plugin-terraform/src/api.ts`)

Handles multipart upload construction:

```typescript
import fs from 'fs'
import {createGzip} from 'zlib'
import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'

import {TerraformArtifactPayload} from './interfaces'

const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://ci-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadTerraformArtifact =
  (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) =>
  async (payload: TerraformArtifactPayload) => {
    const form = new FormData()

    // Build event envelope according to RFC spec
    const event: Record<string, any> = {
      type: 'terraform_artifact',
      track_type: 'ciiac',
      schema_version: '1.0',
      artifact_type: payload.artifactType,
      artifact_format: 'terraform-json',
      artifact_sha256: payload.artifactSha256,
      artifact_size_bytes: payload.artifactSizeBytes,
      ...payload.spanTags,
    }

    // Add repo_id if available
    if (payload.repoId) {
      event.repo_id = payload.repoId
    }

    // Append event JSON
    form.append('event', JSON.stringify(event), {filename: 'event.json'})

    // Append gzipped file content
    const gzippedContent = await gzipContent(payload.fileContent)
    form.append('iac_file', gzippedContent, {
      filename: `${payload.artifactType}.json.gz`,
      contentType: 'application/gzip',
    })

    return request({
      data: form,
      headers: form.getHeaders(),
      maxBodyLength,
      method: 'POST',
      url: 'api/v2/ciiac',
    })
  }

const gzipContent = (content: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const gzip = createGzip()

    gzip.on('data', (chunk) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)

    gzip.write(content)
    gzip.end()
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadTerraformArtifact: uploadTerraformArtifact(requestIntake),
  }
}
```

### 5. Interfaces (`packages/plugin-terraform/src/interfaces.ts`)

```typescript
import type {AxiosPromise, AxiosResponse} from 'axios'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

export interface TerraformArtifactPayload {
  artifactType: 'plan' | 'state'
  filePath: string
  fileContent: string
  artifactSha256: string
  artifactSizeBytes: number
  spanTags: SpanTags
  repoId?: string
}

export interface APIHelper {
  uploadTerraformArtifact(payload: TerraformArtifactPayload): AxiosPromise<AxiosResponse>
}
```

### 6. Utilities (`packages/plugin-terraform/src/utils.ts`)

```typescript
import fs from 'fs'
import {createHash} from 'crypto'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {GIT_REPOSITORY_URL} from '@datadog/datadog-ci-base/helpers/tags'

export const validateArtifactType = (type: string): boolean => {
  return type === 'plan' || type === 'state'
}

export const validateFilePath = (filePath: string): boolean => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export const validateJsonStructure = (content: string): boolean => {
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

export const computeFileHash = (content: string): string => {
  const hash = createHash('sha256')
  hash.update(content)
  return hash.digest('hex')
}

/**
 * Resolve repo_id with the following priority:
 * 1. Explicit flag value (--repo-id)
 * 2. Environment variable (DD_GIT_REPOSITORY_URL or similar)
 * 3. Git metadata extracted from spanTags
 */
export const resolveRepoId = (
  flagValue: string | undefined,
  spanTags: SpanTags
): string | undefined => {
  if (flagValue) {
    return flagValue
  }

  // Try environment variables
  const envRepoId = process.env.DD_GIT_REPOSITORY_URL || process.env.DD_REPOSITORY_URL
  if (envRepoId) {
    return envRepoId
  }

  // Fall back to git metadata
  return spanTags[GIT_REPOSITORY_URL]
}
```

### 7. Renderer (`packages/plugin-terraform/src/renderer.ts`)

```typescript
import chalk from 'chalk'
import {TerraformArtifactPayload} from './interfaces'

export const renderCommandInfo = (
  artifactType: string,
  filePath: string,
  dryRun: boolean
): string => {
  const prefix = dryRun ? '[DRYRUN] ' : ''
  return `${prefix}Uploading Terraform ${artifactType} file: ${filePath}\n`
}

export const renderDryRunUpload = (payload: TerraformArtifactPayload): string => {
  return chalk.yellow(`[DRYRUN] Would upload: ${payload.filePath}\n`)
}

export const renderSuccessfulUpload = (filePath: string): string => {
  return chalk.green(`✓ Successfully uploaded: ${filePath}\n`)
}

export const renderFailedUpload = (filePath: string, error: any): string => {
  const message = error?.message || 'Unknown error'
  return chalk.red(`✗ Failed to upload ${filePath}: ${message}\n`)
}

export const renderInvalidFile = (filePath: string, reason: string): string => {
  return chalk.red(`✗ Invalid file ${filePath}: ${reason}\n`)
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number): string => {
  const prefix = dryRun ? '[DRYRUN] ' : ''
  return chalk.green(`${prefix}✓ Git metadata synced (${elapsed}ms)\n`)
}

export const renderFailedGitDBSync = (error: any): string => {
  const message = error?.message || 'Unknown error'
  return chalk.yellow(`⚠ Failed to sync git metadata: ${message}\n`)
}
```

## Error Handling Strategy

### Validation Errors (User Errors)
- **Invalid artifact type**: Exit with error code 1, display usage
- **File not found**: Exit with error code 1, display error message
- **Invalid JSON**: Exit with error code 1, display error message
- **Missing API key**: Exit with error code 1 immediately

### Network/API Errors (Transient)
- **5xx errors**: Retry up to 5 times with exponential backoff
- **429 (Rate limit)**: Retry with backoff
- **Network timeout**: Retry with backoff

### Critical Errors
- **400 (Bad Request)**: Exit with error code 1, display error message
- **403 (Forbidden)**: Exit with error code 1, display error message
- **Other 4xx errors**: Exit with error code 1, display error message

### Error Messages
All error messages should:
- Use chalk for color-coding (red for errors, yellow for warnings)
- Provide actionable guidance
- Include relevant context (file path, error details)
- Reference documentation when appropriate

## Testing Strategy

### Unit Tests
1. **Validation functions**:
   - `validateArtifactType()` - test valid/invalid types
   - `validateFilePath()` - test existing/missing files
   - `validateJsonStructure()` - test valid/invalid JSON
   - `computeFileHash()` - test hash computation
   - `resolveRepoId()` - test priority order

2. **API helper**:
   - Mock axios requests
   - Test multipart form construction
   - Test gzip compression
   - Test event envelope structure

3. **Renderer functions**:
   - Test output formatting
   - Test color coding

### Integration Tests
1. Test full upload flow with mock server
2. Test git metadata extraction
3. Test retry logic with simulated failures
4. Test dry-run mode

### End-to-End Tests
1. Test with actual Terraform plan file
2. Test with actual Terraform state file
3. Test error scenarios (missing files, invalid JSON, network errors)

## Dependencies

### New Dependencies
All dependencies are already available in the existing codebase:
- `form-data` - Already used by plugin-coverage
- `axios` - Already used throughout
- `clipanion` - Already used for CLI parsing
- `chalk` - Already used for output formatting
- `crypto` (Node.js built-in) - Used for SHA256 hashing
- `zlib` (Node.js built-in) - Used for gzip compression

### Peer Dependencies
```json
{
  "peerDependencies": {
    "@datadog/datadog-ci-base": "workspace:*"
  }
}
```

## Security Considerations

### Sensitive Data
- Terraform files may contain sensitive values (secrets, credentials)
- Files are gzipped in transit
- TLS encryption for all network communication
- No client-side redaction or filtering (per RFC requirements)
- Files stored in S3 with encryption at rest (handled by backend)

### API Key Handling
- API key read from environment variables only
- Never logged or exposed in output
- Passed via request builder helper

### File Access
- Only read files explicitly specified by user
- Validate file paths to prevent directory traversal
- Handle file read errors gracefully

## Backwards Compatibility

This is a new command with no existing functionality to maintain. Key considerations:
- New endpoint (`/api/v2/ciiac`) is separate from existing endpoints
- New track type (`ciiac`) won't conflict with existing track types
- Plugin architecture allows opt-in installation

## Rollout Considerations

### Phase 1: Initial Implementation
1. Create base command structure
2. Implement plugin with core upload functionality
3. Add unit tests
4. Add integration tests

### Phase 2: Testing & Validation
1. Internal dogfooding with test repositories
2. Validate event envelope structure with backend team
3. Test with various Terraform file sizes (1MB - 100MB)
4. Verify retry logic and error handling

### Phase 3: Documentation & Release
1. Create plugin README with usage examples
2. Update main CLI documentation
3. Add command to help output
4. Release as private beta

### Phase 4: GA Release
1. Monitor usage metrics and error rates
2. Gather user feedback
3. Address any issues
4. Release to general availability

## Open Questions & Decisions Needed

### 1. Repository Identifier Format
**Question**: What exact format should `repo_id` use?
- GitHub numeric ID?
- GitLab project ID?
- URL format (e.g., `github.com/org/repo`)?
- Internal Datadog repo entity ID?

**Recommendation**: Use URL format (`github.com/org/repo`) initially, as it's:
- Human-readable
- Already available from git metadata
- Consistent with existing git.repository_url tag
- Easy to migrate to other formats later if needed

**Implementation**: Use `git.repository_url` as default, allow override via `--repo-id` flag

### 2. Artifact Type Validation
**Question**: Should we validate that the JSON content matches the artifact type (plan vs state)?

**Recommendation**: No validation in Phase 1
- RFC explicitly states "no client-side validations, filtering, redaction, or parsing"
- Backend will validate structure
- Keeps CLI simple and fast
- User is responsible for specifying correct type

### 3. Large File Handling
**Question**: Should we enforce size limits on the client side?

**Recommendation**: No client-side size limits
- Backend will return 413 (Payload Too Large) if needed
- Let server enforce limits
- Avoids keeping limits in sync between client and server

**Note**: Use `maxBodyLength: Infinity` in axios config (same as coverage command)

### 4. Git Metadata Sync
**Question**: Should we always sync git metadata like the coverage command does?

**Recommendation**: Yes, with `--skip-git-metadata-upload` flag
- Consistent with coverage command behavior
- Ensures git commit data is available for backend indexing
- Optional via flag for users who manage git metadata separately

## File Size & Deprecation Notes

### Deprecated Functionality
According to RFC review, there is NO deprecated functionality to avoid. This is a net-new feature.

### File Size Expectations (from RFC)
- **Average**: 1-10 MB
- **P99**: 100+ MB
- **Peak scale**: ~30 uploads/second during CI windows

### Implementation Notes for Large Files
1. Use streaming for gzip compression (already implemented via `createGzip()`)
2. Use `maxBodyLength: Infinity` in axios config
3. No client-side size validation
4. Rely on backend 413 errors for oversized files

## Limitations & Non-Goals (from RFC)

### Explicitly Out of Scope
1. **No client-side validation**: CLI uploads artifacts without validating, filtering, or redacting content
2. **No Terraform integration**: No integration with Terraform state locking mechanisms
3. **No other IaC tools**: Only Terraform plan and state files supported in MVP (endpoint named generically for future expansion)
4. **Single file upload only**: Command accepts one file path at a time; users must invoke command multiple times for multiple files
5. **No glob pattern support**: User must explicitly specify exact file path (no wildcard matching)

## Success Criteria

### Functional Requirements
- [ ] Command accepts 'plan' or 'state' artifact type
- [ ] Command accepts a single file path
- [ ] File is validated (exists, readable, valid JSON)
- [ ] SHA256 hash computed correctly
- [ ] File size computed correctly
- [ ] Event envelope matches RFC spec exactly
- [ ] File is gzipped before upload
- [ ] Multipart upload constructed correctly
- [ ] Git/CI metadata enriched automatically
- [ ] repo_id resolved from flag → env → git metadata
- [ ] Retry logic works for transient errors
- [ ] Dry-run mode works correctly
- [ ] Verbose logging provides useful debug info
- [ ] Error messages are clear and actionable

### Non-Functional Requirements
- [ ] Upload completes within reasonable time (< 5s for 10MB file)
- [ ] Large files (100MB+) upload successfully
- [ ] Command works in all major CI environments (GitHub, GitLab, Jenkins, etc.)
- [ ] Command handles network failures gracefully
- [ ] Memory usage is reasonable for large files
- [ ] Unit test coverage > 80%
- [ ] Integration tests cover main scenarios
- [ ] Documentation is clear and complete

## Timeline Estimate

### Phase 1: Core Implementation (5-7 days)
- Day 1-2: Base command structure + plugin scaffolding
- Day 3-4: Core upload logic + API helper
- Day 5: Utilities, validation, renderer
- Day 6-7: Unit tests

### Phase 2: Integration & Testing (3-4 days)
- Day 8-9: Integration tests
- Day 10: End-to-end testing with real files
- Day 11: Bug fixes and refinement

### Phase 3: Documentation & Review (2-3 days)
- Day 12: Plugin README and examples
- Day 13: Code review and feedback incorporation
- Day 14: Final testing and validation

**Total Estimate**: 10-14 days for full implementation, testing, and documentation

## Appendix: Key Files to Reference

### Existing Patterns
- Coverage upload command: `packages/plugin-coverage/src/commands/upload.ts`
- Coverage API: `packages/plugin-coverage/src/api.ts`
- SBOM upload command: `packages/plugin-sbom/src/commands/upload.ts`
- Plugin helper: `packages/base/src/helpers/plugin.ts`
- Git metadata: `packages/base/src/commands/git-metadata/`
- CI helpers: `packages/base/src/helpers/ci.ts`
- Tag helpers: `packages/base/src/helpers/tags.ts`

### TypeScript Interfaces
- SpanTags: `packages/base/src/helpers/interfaces.ts`
- Multipart upload examples: `packages/plugin-coverage/src/api.ts`

### Testing Examples
- Coverage tests: `packages/plugin-coverage/src/__tests__/`
- SBOM tests: `packages/plugin-sbom/src/__tests__/`

## Summary

This implementation plan provides a comprehensive blueprint for adding the `terraform upload` command following existing patterns in the datadog-ci codebase. The design:

1. **Follows established patterns**: Plugin architecture, Clipanion commands, multipart uploads
2. **Reuses existing helpers**: Git metadata, CI tags, retry logic, request builder
3. **Adheres to RFC spec**: Event envelope structure, endpoint, track type
4. **Handles errors robustly**: Validation, retries, clear error messages
5. **Supports common workflows**: Dry-run, verbose logging, git metadata sync
6. **Provides good UX**: Clear output, progress indication, actionable errors
7. **Is well-tested**: Unit, integration, and e2e tests
8. **Is documented**: README, examples, inline comments

The implementation can proceed incrementally with clear phases and success criteria for each phase.
