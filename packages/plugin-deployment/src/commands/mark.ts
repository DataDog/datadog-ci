import {DeploymentMarkCommand} from '@datadog/datadog-ci-base/commands/deployment/mark-command'
import {TagCommand} from '@datadog/datadog-ci-base/commands/tag/tag-command'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'

import {
  CUSTOM_TAGS_TAG,
  ENV_TAG,
  IS_DEPLOYMENT_TAG,
  IS_ROLLBACK_TAG,
  REVISION_TAG,
  SERVICE_TAG,
  CONTAINS_DEPLOYMENT_TAG,
} from '../constants'

export class PluginCommand extends DeploymentMarkCommand {
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
