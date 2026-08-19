import fs from 'fs'

import {Command, Option} from 'clipanion'
import upath from 'upath'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'

import {addDebugIdToPayloads, injectMissingDebugIds} from './debugId'
import {findSourcemaps} from './discovery'
import {Sourcemap} from './interfaces'

export class SourcemapsInjectCommand extends BaseCommand {
  public static paths = [['sourcemaps', 'inject']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Inject debug IDs into JavaScript bundles and sourcemaps.',
    details: `
      This command modifies JavaScript bundles and their corresponding sourcemaps in place. Run it after building and before deploying or uploading the same artifacts to Datadog.
    `,
    examples: [
      ['Inject debug IDs into all bundles in a directory', 'datadog-ci sourcemaps inject ./dist'],
      ['Preview injection without modifying files', 'datadog-ci sourcemaps inject ./dist --dry-run'],
    ],
  })

  private basePath = Option.String({required: true})
  private dryRun = Option.Boolean('--dry-run', false)
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<number> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)
    this.basePath = upath.normalize(this.basePath)

    if (!fs.existsSync(this.basePath)) {
      this.context.stderr.write(`Path does not exist: ${this.basePath}\n`)

      return 1
    }

    const payloads = await findSourcemaps(this.basePath, 20, (minifiedFilePath, sourcemapPath) => {
      const relativePath = upath.relative(this.basePath, minifiedFilePath)

      return new Sourcemap(minifiedFilePath, relativePath, sourcemapPath, relativePath)
    })

    if (payloads.length === 0) {
      this.context.stdout.write(`No JavaScript sourcemaps found in ${this.basePath}.\n`)

      return 0
    }

    addDebugIdToPayloads(payloads)
    const result = injectMissingDebugIds(payloads, this.dryRun, this.context.stdout)
    this.context.stdout.write(
      `${this.dryRun ? 'Would inject' : 'Injected'} debug IDs into ${result.injected} file(s); skipped ${result.skipped} file(s) with existing debug IDs; failed ${result.failed} file(s).\n`
    )

    return result.failed === 0 ? 0 : 1
  }
}
