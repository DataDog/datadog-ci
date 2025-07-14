import type {
  IContainer,
  IService,
  IJob,
  IJobTemplate,
  IVolume,
  ServicesClient as IServicesClient,
  JobsClient as IJobsClient,
} from './types'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {renderError, renderSoftWarning} from '../../helpers/renderer'

import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from './constants'
import {requestGCPProject, requestGCPRegion, requestServiceName, requestConfirmation} from './prompt'
import {dryRunPrefix, renderAuthenticationInstructions, withSpinner} from './renderer'
import {checkAuthentication, fetchServiceConfigs, fetchJobConfigs, generateConfigDiff} from './utils'

// XXX temporary workaround for @google-cloud/run ESM/CJS module issues
const {ServicesClient, JobsClient} = require('@google-cloud/run')

export class UninstrumentCommand extends Command {
  public static paths = [['cloud-run', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Cloud Run service or job.',
  })

  private dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private project = Option.String('-p,--project', {
    description: 'GCP project ID',
  })
  private services = Option.Array('-s,--service,--services', [], {
    description: 'Cloud Run service(s) to uninstrument',
  })
  private jobs = Option.Array('-j,--job,--jobs', [], {
    description: 'Cloud Run job(s) to uninstrument',
  })
  private interactive = Option.Boolean('-i,--interactive', false, {
    description: 'Prompt for flags one at a time',
  })
  private region = Option.String('-r,--region', {
    description: 'GCP region your service(s) are deployed in',
  })
  private sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `The name of the sidecar container to remove. Specify if you have a different sidecar name. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  private sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `The name of the shared volume to remove. Specify if you have a different shared volume name. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.context.stdout.write(
      `\n${dryRunPrefix(this.dryRun)}🐶 ${chalk.bold('Uninstrumenting Cloud Run service(s) or job(s)')}\n\n`
    )

    if (this.interactive) {
      if (!this.project) {
        this.project = await requestGCPProject()
      }

      if (!this.region) {
        this.region = await requestGCPRegion()
      }

      if (this.services.length === 0 && this.jobs.length === 0) {
        const serviceName = await requestServiceName()
        this.services = [serviceName]
      }
    }

    // Validate required variables
    if (!this.project) {
      this.context.stdout.write(chalk.yellow('Invalid or missing project. Please use the --project flag.\n'))
    }
    if (this.services.length > 0 && this.jobs.length > 0) {
      this.context.stdout.write(
        chalk.yellow('Cannot specify both services and jobs. Please use either --service or --job flags, not both.\n')
      )
    }
    if (this.services.length === 0 && this.jobs.length === 0) {
      this.context.stdout.write(
        chalk.yellow('Invalid or missing service(s) or job(s). Please use either the --service or --job flag.\n')
      )
    }
    if (!this.region) {
      this.context.stdout.write(chalk.yellow('Invalid or missing region. Please use the --region flag.\n'))
    }

    if (
      !this.project ||
      (this.services.length === 0 && this.jobs.length === 0) ||
      !this.region ||
      (this.services.length > 0 && this.jobs.length > 0)
    ) {
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

    // Uninstrument services or jobs with sidecar
    try {
      if (this.services.length > 0) {
        await this.uninstrumentSidecar(this.project, this.services, this.region)
      } else {
        await this.uninstrumentJobSidecar(this.project, this.jobs, this.region)
      }
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
    const client: IServicesClient = new ServicesClient()

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

  public async uninstrumentJobSidecar(project: string, jobs: string[], region: string) {
    const client: IJobsClient = new JobsClient()

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}⬇️ Fetching existing job configurations from Cloud Run...\n`)
    )
    const existingJobConfigs = await fetchJobConfigs(client, project, region, jobs)

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}🚀 Uninstrumenting Cloud Run jobs with sidecar...\n`)
    )
    for (let i = 0; i < existingJobConfigs.length; i++) {
      const jobConfig = existingJobConfigs[i]
      const jobName = jobs[i]
      try {
        await this.uninstrumentJob(client, jobConfig, jobName)
      } catch (error) {
        this.context.stderr.write(
          dryRunPrefix(this.dryRun) + renderError(`Failed to uninstrument job ${jobName}: ${error}\n`)
        )
        throw error
      }
    }
  }

  public async uninstrumentService(client: IServicesClient, existingService: IService, serviceName: string) {
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

  public async uninstrumentJob(client: IJobsClient, existingJob: IJob, jobName: string) {
    const updatedJob = this.createUninstrumentedJobConfig(existingJob)
    this.context.stdout.write(generateConfigDiff(existingJob, updatedJob))
    if (this.dryRun) {
      this.context.stdout.write(
        `\n\n${dryRunPrefix(this.dryRun)}Would have updated job ${chalk.bold(jobName)} with the above changes.\n`
      )

      return
    } else if (this.interactive) {
      const confirmed = await requestConfirmation('\nDo you want to apply the changes?')
      if (!confirmed) {
        throw new Error('Uninstrumentation cancelled by user.')
      }
    }

    await withSpinner(
      `Uninstrumenting job ${chalk.bold(jobName)}...`,
      async () => {
        const [operation] = await client.updateJob({
          job: updatedJob,
        })
        await operation.promise()
      },
      `Uninstrumented job ${chalk.bold(jobName)}`
    )
  }

  public createUninstrumentedServiceConfig(service: IService): IService {
    const template = service.template || {}
    const containers: IContainer[] = template.containers || []
    const volumes: IVolume[] = template.volumes || []

    let updatedContainers = containers.filter((c) => c.name !== this.sidecarName)
    const updatedVolumes = volumes.filter((v) => v.name !== this.sharedVolumeName)

    if (updatedContainers.length === containers.length) {
      this.context.stdout.write(
        renderSoftWarning(`Sidecar container '${this.sidecarName}' not found, so no container was removed. Specify the container name with --sidecar-name.
`)
      )
    }

    if (updatedVolumes.length === volumes.length) {
      this.context.stdout.write(
        renderSoftWarning(`Shared volume '${this.sharedVolumeName}' not found, so no shared volume was removed. Specify the shared volume name with --shared-volume-name.
`)
      )
    }

    updatedContainers = updatedContainers.map((c) => this.updateAppContainer(c))

    return {
      ...service,
      template: {
        ...template,
        containers: updatedContainers,
        volumes: updatedVolumes,
        // Let GCR generate the next revision name
        revision: undefined,
      },
    }
  }

  public createUninstrumentedJobConfig(job: IJob): IJob {
    const template: IJobTemplate = job.template || {}
    const innerTemplate = template.template || {}
    const containers: IContainer[] = innerTemplate.containers || []
    const volumes: IVolume[] = innerTemplate.volumes || []

    let updatedContainers = containers.filter((c) => c.name !== this.sidecarName)
    const updatedVolumes = volumes.filter((v) => v.name !== this.sharedVolumeName)

    if (updatedContainers.length === containers.length) {
      this.context.stdout.write(
        renderSoftWarning(`Sidecar container '${this.sidecarName}' not found, so no container was removed. Specify the container name with --sidecar-name.
`)
      )
    }

    if (updatedVolumes.length === volumes.length) {
      this.context.stdout.write(
        renderSoftWarning(`Shared volume '${this.sharedVolumeName}' not found, so no shared volume was removed. Specify the shared volume name with --shared-volume-name.
`)
      )
    }

    updatedContainers = updatedContainers.map((c) => this.updateAppContainer(c))

    return {
      ...job,
      template: {
        ...template,
        template: {
          ...innerTemplate,
          containers: updatedContainers,
          volumes: updatedVolumes,
        },
      } as IJobTemplate,
    }
  }

  // Remove volume mount and add required env vars
  private updateAppContainer(appContainer: IContainer) {
    const existingVolumeMounts = appContainer.volumeMounts || []
    const updatedVolumeMounts = existingVolumeMounts.filter((v) => v.name !== this.sharedVolumeName)

    const existingEnvVars = appContainer.env || []
    // Remove env vars beginning with DD_
    const updatedEnvVars = existingEnvVars.filter((v) => !v.name.startsWith('DD_'))

    return {
      ...appContainer,
      volumeMounts: updatedVolumeMounts,
      env: updatedEnvVars,
    }
  }
}
