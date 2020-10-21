import {Cli} from 'clipanion/lib/advanced'
import {UploadCommand} from '../../upload'
import {createMockContext} from './context'

interface RunUploadInput {
  apiKey?: string
  appKey?: string
  dryRun?: boolean
  releaseVersion?: string
  service?: string
  source?: string
}

export const runUploadCommand = async (filePath: string, input: RunUploadInput) => {
  const cli = new Cli()
  cli.register(UploadCommand)

  const context = createMockContext()

  process.env = {
    DATADOG_API_KEY: input.apiKey,
    DATADOG_APP_KEY: input.appKey,
  }
  const params = ['dependencies', 'upload', filePath]

  if (input.releaseVersion) {
    params.push('--release-version', input.releaseVersion)
  }
  if (input.service) {
    params.push('--service', input.service)
  }
  if (input.source) {
    params.push('--source', input.source)
  }
  if (input.dryRun) {
    params.push('--dry-run')
  }

  const code = await cli.run(params, context)

  return {context, code}
}
