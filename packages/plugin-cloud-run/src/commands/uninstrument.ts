import type {IService} from '../types'

import {CloudRunUninstrumentCommand} from '@datadog/datadog-ci-base/commands/cloud-run/uninstrument'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {ServicesClient} from '@google-cloud/run'
import chalk from 'chalk'

import {requestGCPProject, requestGCPRegion, requestServiceName, requestConfirmation} from '../prompt'
import {dryRunPrefix, renderAuthenticationInstructions, withSpinner} from '../renderer'
import {uninstrumentServiceConfig} from '../service-config'
import {checkAuthentication, fetchServiceConfigs} from '../utils'

export class PluginCommand extends CloudRunUninstrumentCommand {
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }
  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.context.stdout.write(
      `\n${dryRunPrefix(this.dryRun)}🐶 ${chalk.bold('Uninstrumenting Cloud Run service(s)')}\n\n`
    )

    if (this.interactive) {
      if (!this.project) {
        this.project = await requestGCPProject()
      }

      if (!this.region) {
        this.region = await requestGCPRegion()
      }

      if (this.services.length === 0) {
        const serviceName = await requestServiceName()
        this.services = [serviceName]
      }
    }

    // Validate required variables
    if (!this.project) {
      this.context.stdout.write(chalk.yellow('Invalid or missing project. Please use the --project flag.\n'))
    }
    if (this.services.length === 0) {
      this.context.stdout.write(chalk.yellow('Invalid or missing service(s). Please use the --service flag.\n'))
    }
    if (!this.region) {
      this.context.stdout.write(chalk.yellow('Invalid or missing region. Please use the --region flag.\n'))
    }

    if (!this.project || !this.services || !this.services.length || !this.region) {
      return 1
    }
    this.context.stdout.write(chalk.green('✔ Required flags verified\n'))

    // Verify GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    const authenticated = await checkAuthentication()
    if (!authenticated) {
      this.context.stderr.write(renderAuthenticationInstructions())

      return 1
    }
    this.context.stdout.write(chalk.green('✔ GCP credentials verified!\n\n'))

    // Instrument services with sidecar
    try {
      await this.uninstrumentSidecar(this.project, this.services, this.region)
    } catch (error) {
      this.context.stderr.write(dryRunPrefix(this.dryRun) + renderError(`Uninstrumentation failed: ${error}\n`))

      return 1
    }

    if (!this.dryRun) {
      this.context.stdout.write('\n✅ Cloud Run uninstrumentation completed successfully!\n')
    }

    return 0
  }

  public async uninstrumentSidecar(project: string, services: string[], region: string) {
    const client = new ServicesClient()

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}⬇️ Fetching existing service configurations from Cloud Run...\n`)
    )
    const existingServiceConfigs = await fetchServiceConfigs(client, project, region, services)

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}🚀 Uninstrumenting Cloud Run services with sidecar...\n`)
    )
    for (let i = 0; i < existingServiceConfigs.length; i++) {
      const serviceConfig = existingServiceConfigs[i]
      const serviceName = services[i]
      try {
        await this.uninstrumentService(client, serviceConfig, serviceName)
      } catch (error) {
        this.context.stderr.write(
          dryRunPrefix(this.dryRun) + renderError(`Failed to instrument service ${serviceName}: ${error}\n`)
        )
        throw error
      }
    }
  }

  public async uninstrumentService(client: ServicesClient, existingService: IService, serviceName: string) {
    const updatedService = this.createUninstrumentedServiceConfig(existingService)
    this.context.stdout.write(generateConfigDiff(existingService, updatedService))
    if (this.dryRun) {
      this.context.stdout.write(
        `\n\n${dryRunPrefix(this.dryRun)}Would have updated service ${chalk.bold(
          serviceName
        )} with the above changes.\n`
      )

      return
    } else if (this.interactive) {
      const confirmed = await requestConfirmation('\nDo you want to apply the changes?')
      if (!confirmed) {
        throw new Error('Uninstrumentation cancelled by user.')
      }
    }

    await withSpinner(
      `Uninstrumenting service ${chalk.bold(serviceName)}...`,
      async () => {
        const [operation] = await client.updateService({
          service: updatedService,
        })
        await operation.promise()
      },
      `Uninstrumented service ${chalk.bold(serviceName)}`
    )
  }

  public createUninstrumentedServiceConfig(service: IService): IService {
    const result = uninstrumentServiceConfig(service, {
      sidecarName: this.sidecarName,
      sharedVolumeName: this.sharedVolumeName,
      envVars: this.envVars,
    })
    if (!result.sidecarRemoved) {
      this.context.stdout.write(
        renderSoftWarning(
          `Sidecar container '${this.sidecarName}' not found, so no container was removed. Specify the container name with --sidecar-name.\n`
        )
      )
    }
    if (!result.sharedVolumeRemoved) {
      this.context.stdout.write(
        renderSoftWarning(
          `Shared volume '${this.sharedVolumeName}' not found, so no shared volume was removed. Specify the shared volume name with --shared-volume-name.\n`
        )
      )
    }

    return result.service
  }
}
