import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-core/constants'
import {toBoolean} from '@datadog/datadog-ci-core/helpers/env'
import {enableFips} from '@datadog/datadog-ci-core/helpers/fips'

import {TagCommand} from '../tag/tag'

import {
  CUSTOM_TAGS_TAG,
  ENV_TAG,
  IS_DEPLOYMENT_TAG,
  IS_ROLLBACK_TAG,
  REVISION_TAG,
  SERVICE_TAG,
  CONTAINS_DEPLOYMENT_TAG,
} from './constants'

/**
 * This command is a wrapper around the datadog-ci tag command, allowing customers to mark CI jobs
 * as deployments and setting specific properties, like the environment or the revision in a simple way.
 */
export class DeploymentMarkCommand extends Command {
  public static paths = [['deployment', 'mark']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Mark a CI job as a deployment.',
    details: `
      This command will mark a CI job as a deployment.\n
      See README for details.
    `,
    examples: [
      ['Mark a CI job as a deployment', 'datadog-ci deployment mark'],
      ['Mark a CI job as a deployment to the staging environment', 'datadog-ci deployment mark --env:staging'],
      ['Mark a CI job as a rollback deployment', 'datadog-ci deployment mark --is-rollback'],
      ['Mark a CI job as a deployment of the v123-456 version', 'datadog-ci deployment mark --revision:v123-456'],
      [
        'Mark a CI job as a deployment for service payment-service',
        'datadog-ci deployment mark --service:payment-service',
      ],
    ],
  })

  private noFail = Option.Boolean('--no-fail', false)
  private isRollback = Option.Boolean('--is-rollback', false)
  private env = Option.String('--env', {
    description: 'Example: prod',
  })
  private revision = Option.String('--revision', {
    description: 'Example: 1.0.0',
  })
  private service = Option.String('--service', {
    description: 'Example: payment-service',
  })
  private tags = Option.Array('--tags')

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    const tagJobCommand = new TagCommand()
    tagJobCommand.setLevel('job')
    tagJobCommand.setTags(this.createJobDeploymentTags())
    tagJobCommand.context = this.context
    tagJobCommand.setSilent(false)

    const tagPipelineCommand = new TagCommand()
    tagPipelineCommand.setLevel('pipeline')
    tagPipelineCommand.setTags(this.createPipelineDeploymentTags())
    tagPipelineCommand.context = this.context
    tagPipelineCommand.setSilent(true)

    if (this.noFail) {
      tagJobCommand.setNoFail(true)
      tagPipelineCommand.setNoFail(true)
    }

    const tagJobCommandExitCode = await tagJobCommand.execute()

    if (tagJobCommandExitCode === 0) {
      return tagPipelineCommand.execute()
    } else {
      return tagJobCommandExitCode
    }
  }

  public createJobDeploymentTags(): string[] {
    const tags = [IS_DEPLOYMENT_TAG]

    if (this.env) {
      tags.push(ENV_TAG + this.env)
    }

    if (this.revision) {
      tags.push(REVISION_TAG + this.revision)
    }

    if (this.service) {
      tags.push(SERVICE_TAG + this.service)
    }

    if (this.isRollback) {
      tags.push(IS_ROLLBACK_TAG)
    }

    if (this.tags) {
      tags.push(CUSTOM_TAGS_TAG + this.tags.join(','))
    }

    return tags
  }

  public createPipelineDeploymentTags(): string[] {
    return [CONTAINS_DEPLOYMENT_TAG]
  }
}
