import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'

import {executePluginCommand} from '../../helpers/plugin'

export class JunitUploadCommand extends BaseCommand {
  public static paths = [['junit', 'upload']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Upload jUnit XML test reports files to Datadog.',
    details: `
      This command will upload to jUnit XML test reports files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all jUnit XML test report files in current directory', 'datadog-ci junit upload --service my-service .'],
      [
        'Discover and upload all jUnit XML test report files doing recursive search in current directory',
        'datadog-ci junit upload --service my-service --auto-discovery .',
      ],
      [
        'Discover and upload all jUnit XML test report files doing recursive search in current directory, ignoring src/ignored-module-a and src/ignored-module-b',
        'datadog-ci junit upload --service my-service --ignored-paths src/ignored-module-a,src/ignored-module-b --auto-discovery .',
      ],
      [
        'Upload all jUnit XML test report files in src/unit-test-reports and src/acceptance-test-reports',
        'datadog-ci junit upload --service my-service src/unit-test-reports src/acceptance-test-reports',
      ],
      [
        'Upload all jUnit XML test report files in current directory and add extra tags globally',
        'datadog-ci junit upload --service my-service --tags key1:value1 --tags key2:value2 .',
      ],
      [
        'Upload all jUnit XML test report files in current directory and add extra measures globally',
        'datadog-ci junit upload --service my-service --measures key1:123 --measures key2:321 .',
      ],
      [
        'Upload all jUnit XML test report files in current directory to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci junit upload --service my-service .',
      ],
      [
        'Upload all jUnit XML test report files in current directory while also collecting logs',
        'datadog-ci junit upload --service my-service --logs .',
      ],
      [
        'Upload all jUnit XML test report files in current directory customizing test suite with xpath',
        'datadog-ci junit upload --service my-service --xpath-tag test.suite=/testcase/@classname .',
      ],
      [
        'Upload all jUnit XML test report files in current directory adding a custom tag from property with xpath',
        "datadog-ci junit upload --service my-service --xpath-tag custom_tag=/testcase/..//property[@name='property-name'] .",
      ],
      [
        'Upload all jUnit XML test report files in current directory with extra verbosity',
        'datadog-ci junit upload --verbose --service my-service .',
      ],
    ],
  })

  public basePaths = Option.Rest({required: 1})
  public verbose = Option.Boolean('--verbose', false)
  public dryRun = Option.Boolean('--dry-run', false)
  public env = Option.String('--env')
  public logs = Option.String('--logs', 'false', {
    env: 'DD_CIVISIBILITY_LOGS_ENABLED',
    tolerateBoolean: true,
    validator: t.isBoolean(),
  })
  public maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  public measures = Option.Array('--measures')
  public service = Option.String('--service', {env: 'DD_SERVICE'})
  public tags = Option.Array('--tags')
  public reportTags = Option.Array('--report-tags')
  public reportMeasures = Option.Array('--report-measures')
  public rawXPathTags = Option.Array('--xpath-tag')
  public gitRepositoryURL = Option.String('--git-repository-url')
  public skipGitMetadataUpload = Option.String('--skip-git-metadata-upload', 'false', {
    validator: t.isBoolean(),
    tolerateBoolean: true,
  })
  public automaticReportsDiscovery = Option.String('--auto-discovery', 'false', {
    validator: t.isBoolean(),
    tolerateBoolean: true,
  })
  public ignoredPaths = Option.String('--ignored-paths')

  public fips = Option.Boolean('--fips', false)
  public fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
