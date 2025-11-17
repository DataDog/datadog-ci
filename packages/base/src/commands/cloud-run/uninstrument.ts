import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from '../../helpers/serverless/constants'

import {BaseCommand} from '../..'

export class CloudRunUninstrumentCommand extends BaseCommand {
  public static paths = [['cloud-run', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Cloud Run app.',
  })

  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description:
      'Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply.',
  })
  protected project = Option.String('-p,--project', {
    description: 'GCP project ID',
  })
  protected services = Option.Array('-s,--service,--services', [], {
    description: 'Cloud Run service(s) to instrument',
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: 'Prompt for flags one at a time',
  })
  protected region = Option.String('-r,--region', {
    description: 'GCP region your service(s) are deployed in',
  })
  protected sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `The name of the sidecar container to remove. Specify if you have a different sidecar name. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  protected sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `The name of the shared volume to remove. Specify if you have a different shared volume name. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  protected envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to remove from the Cloud Run service. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
