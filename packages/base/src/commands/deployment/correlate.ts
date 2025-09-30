import {Command, Option} from 'clipanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

/**
 * This command collects environment variables and git information to correlate commits from the
 * source code repository to the configuration repository. This allows to connect pipelines triggering
 * changes on the configuration repository to deployments from gitOps CD providers
 */
export class DeploymentCorrelateCommand extends Command {
  public static paths = [['deployment', 'correlate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate GitOps CD deployments with CI pipelines.',
    details: `
      This command will correlate the pipeline with a GitOps CD deployment.\n
      See README for additional details.
    `,
    examples: [
      ['Correlate an Argo CD deployment', 'datadog-ci deployment correlate --provider argocd'],
      [
        'Correlate ArgoCD deployment manually',
        'datadog-ci deployment correlate --provider argocd --config-repo https://github.com/my-manifests-repo --config-shas 92eb0db6926aaf51b9fb223895b6d8d1c0ff1ff4',
      ],
      [
        'Correlate ArgoCD deployment manually to several commits',
        'datadog-ci deployment correlate --provider argocd --config-repo https://github.com/my-manifests-repo --config-shas 92eb0db6926aaf51b9fb223895b6d8d1c0ff1ff4 --config-shas e996e5c30ba1cb4dc7f634ab4a0a59473741c4de',
      ],
    ],
  })

  protected cdProviderParam = Option.String('--provider')
  protected configurationRepo = Option.String('--config-repo')
  protected configurationShas = Option.Array('--config-shas')
  protected dryRun = Option.Boolean('--dry-run', false)

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
