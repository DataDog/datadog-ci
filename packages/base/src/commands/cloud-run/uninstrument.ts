import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from './constants'

export class UninstrumentCommand extends Command {
  public static paths = [['cloud-run', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Cloud Run app.',
  })

  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false)
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
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
