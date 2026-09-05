import {Command, Option, UsageError} from 'clipanion'
// Clipanion's public Boolean helper intentionally lets the last repeated positive/negative flag win.
// This command needs to reject `--browser --no-browser`, so retain the parser state for this one option.
// eslint-disable-next-line no-restricted-imports
import {makeCommandOption} from 'clipanion/lib/advanced/options/utils'

import {isStandaloneBinary} from '@datadog/datadog-ci-base/helpers/is-standalone-binary'
import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'

import {BaseCommand} from '../..'

const browserPreferenceOption = () =>
  makeCommandOption<boolean | undefined>({
    definition: (builder) => {
      builder.addOption({allowBinding: false, arity: 0, names: ['--browser']})
    },
    transformer: (_builder, _key, state) => {
      const values = state.options.filter(({name}) => name === '--browser').map(({value}) => value as boolean)
      if (values.length > 1) {
        throw new UsageError('Options --browser and --no-browser cannot be used together.')
      }

      return values[0]
    },
  })

export class AuthLoginCommand extends BaseCommand {
  public static paths = [['auth', 'login']]

  public static usage = Command.Usage({
    category: 'Authentication',
    description: 'Authenticate datadog-ci with your Datadog account.',
    details: `
      Opens Datadog in your browser and stores an OAuth session in your operating system keychain.
      In a cloud shell or headless terminal, prints a URL and accepts the final localhost redirect URL on stdin.
      This command is available only from the npm distribution of datadog-ci.
    `,
    examples: [
      ['Log in with the default site and scopes', 'datadog-ci auth login'],
      ['Log in without opening a browser', 'datadog-ci auth login --no-browser'],
      ['Log in to the EU site', 'datadog-ci auth login --site datadoghq.eu'],
    ],
  })

  protected site = Option.String('--site')
  protected scopes = Option.Array('--scope')
  protected browser = browserPreferenceOption()
  protected callbackPort = Option.String('--callback-port', {validator: validation.isInteger()})

  public async execute(): Promise<number | void> {
    if ((await isStandaloneBinary()) || process.env.DD_CI_DISTRIBUTION === 'official-container') {
      this.context.stderr.write(
        'The auth login command is only available from the npm distribution of datadog-ci. Install @datadog/datadog-ci with npm and try again.\n'
      )

      return 1
    }

    return executePluginCommand(this)
  }
}
