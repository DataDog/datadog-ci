import {DATADOG_CI_COMMAND} from '../../helpers/exec'

import {region} from './ecs-fargate-fixtures'

/**
 * The key the Agent is instrumented with. `DATADOG_API_KEY` comes first because CI also exports a
 * CI Visibility `DD_API_KEY` belonging to another organization, which must not reach a task
 * definition. Locally only one of the two is usually set, so either is accepted.
 */
export const apiKey = (): string | undefined => process.env.DATADOG_API_KEY ?? process.env.DD_API_KEY

const site = (): string | undefined => process.env.DATADOG_SITE ?? process.env.DD_SITE

/** The commands are in beta, so every run has to opt in. */
export const commandEnv = (): Record<string, string | undefined> => ({
  DD_BETA_COMMANDS_ENABLED: '1',
  DATADOG_API_KEY: apiKey(),
  DD_API_KEY: apiKey(),
  DD_SITE: site(),
  DATADOG_SITE: site(),
})

export const instrumentCommand = (families: string[], flags = ''): string =>
  `${DATADOG_CI_COMMAND} ecs-fargate instrument` +
  families.map((family) => ` --task-definition "${family}"`).join('') +
  ` -r "${region}"` +
  ` --no-source-code-integration` +
  (flags ? ` ${flags}` : '')

export const uninstrumentCommand = (families: string[], flags = ''): string =>
  `${DATADOG_CI_COMMAND} ecs-fargate uninstrument` +
  families.map((family) => ` --task-definition "${family}"`).join('') +
  ` -r "${region}"` +
  (flags ? ` ${flags}` : '')
