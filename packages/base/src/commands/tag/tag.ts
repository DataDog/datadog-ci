import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import { executePluginCommand } from '@datadog/datadog-ci-base/helpers/plugin'

export class TagCommand extends Command {
  public static paths = [['tag']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Add tags to a CI Pipeline trace pipeline or job span in Datadog.',
    details: `
            This command when run from a supported CI provider sends an arbitrary set of key:value
            tags to Datadog to include in the CI Visibility traces.
    `,
    examples: [
      ['Add a team tag to the current pipeline', 'datadog-ci tag --level pipeline --tags team:backend'],
      ['Tag the current CI job with the go version', 'datadog-ci tag --level job --tags "go.version:`go version`"'],
      ['Add tags in bulk using a JSON file', 'datadog-ci tag --level job --tags-file my_tags.json'],
    ],
  })

  protected level = Option.String('--level')
  protected noFail = Option.Boolean('--no-fail')
  protected silent = Option.Boolean('--silent')
  protected tags = Option.Array('--tags')
  protected tagsFile = Option.String('--tags-file')

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  protected config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public setLevel(level: string) {
    this.level = level
  }

  public setTags(tags: string[]) {
    this.tags = tags

    // When this command is used by another command (e.g. `deployment mark`), the command options are not resolved
    // and are still Clipanion option constructors: `this.tagsFile` is not a valid path.
    delete this.tagsFile
  }

  public setNoFail(noFail: boolean) {
    this.noFail = noFail
  }

  public setSilent(silent: boolean) {
    this.silent = silent
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
