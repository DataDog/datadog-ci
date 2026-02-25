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

  // FIPS mode
  protected fips = Option.Boolean('--fips', false, {description: 'Enable FIPS mode for the command'})
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false, {
    description: 'Ignore FIPS errors and continue execution',
  })

  // Dry run mode
  protected dryRun = Option.Boolean('--dry-run', false, {
    description: 'Run the command in dry run mode, without uploading any data to Datadog',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
