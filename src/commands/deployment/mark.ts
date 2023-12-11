import {Command, Option} from "clipanion";
import {TagCommand} from "../tag/tag";

/**
 * This command is a wrapper around the datadog-ci tag command, allowing customers to mark CI Jobs
 * as deployments and setting specific properties, like the environment or the revision in a simple way.
 */
export class DeploymentMarkCommand extends Command {
  public static paths = [['deployment', 'mark']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Mark a job as a deployment',
    details: `
      This command will mark a job as a deployment.\n
      See README for details.
    `,
    examples: [
      ['Mark a job as a deployment', 'datadog-ci deployment mark'],
      ['Mark a job as a deployment to the staging environment', 'datadog-ci deployment mark --env:staging'],
      ['Mark a job as a rollback deployment', 'datadog-ci deployment mark --is-rollback'],
      ['Mark a job as a deployment of the v123-456 version', 'datadog-ci deployment mark --revision:v123-456'],
    ],
  })

  private cdVisPrefix = "datadog_cd_visibility."
  private deploymentJobTag = this.cdVisPrefix + "enabled:true"
  private envTag = this.cdVisPrefix + "env:"
  private revisionTag = this.cdVisPrefix + "revision:"
  private isRollbackTag = this.cdVisPrefix + "is_rollback:true"
  private customTagsTag = this.cdVisPrefix + "custom_tags:"

  private noFail = Option.Boolean('--no-fail')
  private isRollback = Option.Boolean('--is-rollback', false)
  private env = Option.String('--env', {
    description: 'Example: prod',
  })
  private revision = Option.String('--revision', {
    description: 'Example: 1.0.0',
  })
  private tags = Option.Array('--tags')

  execute(): Promise<number | void> {
    let tagCommand = new TagCommand()
    tagCommand.setLevel('job')
    tagCommand.setTags(this.createDeploymentTags())

    if (this.noFail) {
      tagCommand.setNoFail(true)
    }

    return tagCommand.execute()
  }

  public createDeploymentTags(): string[] {
    let tags = [this.deploymentJobTag]

    if (this.env) {
      tags.push(this.envTag + this.env)
    }

    if (this.revision) {
      tags.push(this.revisionTag + this.revision)
    }

    if (this.isRollback) {
      tags.push(this.isRollbackTag)
    }

    if (this.tags) {
      tags.push(this.customTagsTag + this.tags)
    }

    return tags
  }
}