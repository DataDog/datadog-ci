import {Command, Option} from 'clipanion'

import {TagCommand} from '../tag/tag'

import {CUSTOM_TAGS_TAG, ENV_TAG, IS_DEPLOYMENT_TAG, IS_ROLLBACK_TAG, REVISION_TAG, SERVICE_TAG} from './constants'

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
      ['Mark a CI job as a deployment for service payment-service', 'datadog-ci deployment mark --service:payment-service'],
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

  public async execute() {
    const tagCommand = new TagCommand()
    tagCommand.setLevel('job')
    tagCommand.setTags(this.createDeploymentTags())
    tagCommand.context = this.context

    if (this.noFail) {
      tagCommand.setNoFail(true)
    }

    return tagCommand.execute()
  }

  public createDeploymentTags(): string[] {
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
}
