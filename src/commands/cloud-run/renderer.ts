import * as helpersRenderer from '../../helpers/renderer'
import {dryRunTag} from '../../helpers/renderer'

import {InstrumentCommand} from './instrument'

const AUTHENTICATION_INSTRUCTIONS = [
  '\n' + helpersRenderer.renderError('Unable to authenticate with GCP.'),
  'To authenticate with GCP, please follow these steps:',
  "1. If you haven't already, install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install",
  '2. Run "gcloud auth application-default login" and follow the prompts in your browser to log in.',
  '3. After logging in, run the `datadog-ci cloud-run flare` command again.\n',
]
/**
 * @returns instructions on how to authenticate with GCP.
 */
export const renderAuthenticationInstructions = () => {
  return AUTHENTICATION_INSTRUCTIONS.join('\n')
}

export const renderCloudRunInstrumentUninstrumentHeader = (commandType: InstrumentCommand, isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  const commandVerb = 'Instrumenting'
  // TODO
  // if (commandType === UninstrumentCommand.prototype) {
  //   commandVerb = 'Uninstrumenting'
  // }

  return `\n${prefix}🐶 ${commandVerb} Cloud Run service\n`
}
