import {Command, Option} from 'clipanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

import {BaseCommand} from '../..'

export class CoverageUploadCommand extends BaseCommand {
  public static paths = [['coverage', 'upload']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Upload code coverage reports files to Datadog.',
    details: `
      This command will upload code coverage report files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all code coverage report files in current directory and its subfolders', 'datadog-ci coverage upload .'],
      [
        'Upload all code coverage report files in current directory and its subfolders, ignoring src/ignored-module-a and src/ignored-module-b',
        'datadog-ci coverage upload --ignored-paths src/ignored-module-a,src/ignored-module-b .',
      ],
      [
        'Upload all code coverage report files in src/unit-test-coverage and src/acceptance-test-coverage',
        'datadog-ci coverage upload src/unit-test-coverage src/acceptance-test-coverage',
      ],
      [
        'Upload all XML code coverage report files in /coverage/ folders, ignoring src/ignored-module-a',
        'datadog-ci coverage upload **/coverage/*.xml --ignored-paths src/ignored-module-a',
      ],
      ['Upload coverage with flags', 'datadog-ci coverage upload --flags type:unit-tests --flags jvm-21 .'],
      [
        'Upload all code coverage report files in current directory to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci coverage upload .',
      ],
      [
        'Upload all code coverage report files in current directory with extra verbosity',
        'datadog-ci coverage upload --verbose .',
      ],
    ],
  })

  protected reportPaths = Option.Rest({required: 1})
  protected flags = Option.Array('--flags', {
    description:
      'Flags to mark coverage reports for grouping and filtering (e.g., type:unit-tests, jvm-21). Maximum 32 flags per report.',
  })
  protected format = Option.String('--format', {description: 'The format of the coverage report files'})
  protected uploadGitDiff = Option.Boolean('--upload-git-diff', true, {
    description:
      'If the command is run in a PR context, it will try to upload the PR git diff along with the coverage data',
  })
  protected skipGitMetadataUpload = Option.Boolean('--skip-git-metadata-upload', false, {
    description: 'Skip the upload of git metadata',
  })
  protected disableFileFixes = Option.Boolean('--disable-file-fixes', false, {
    description: 'Disable the generation and upload of file fixes for code coverage',
  })
  protected gitRepositoryURL = Option.String('--git-repository-url', {
    description: 'The repository URL to retrieve git metadata from',
  })
  protected basePath = Option.String('--base-path', {description: 'The base path to the coverage report files'})

  protected ignoredPaths = Option.String('--ignored-paths', {
    description:
      'A comma-separated list of paths that should be excluded from automatic reports discovery (only applicable when `--auto-discovery` is set). Glob patterns are supported.',
  })

  protected fips = Option.Boolean('--fips', false, {description: 'Enable FIPS mode for the command'})
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false, {
    description: 'Ignore FIPS errors and continue execution',
  })

  protected verbose = Option.Boolean('--verbose', false, {hidden: true})
  protected dryRun = Option.Boolean('--dry-run', false, {
    description: 'Run the command in dry run mode, without uploading any data to Datadog',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
