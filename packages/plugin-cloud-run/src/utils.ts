import type {IService} from './types'

import {ServicesClient} from '@google-cloud/run'
import chalk from 'chalk'
import {GoogleAuth} from 'google-auth-library'

import {withSpinner} from './renderer'

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
export const checkAuthentication = async () => {
  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (_) {
    return false
  }
}

export const fetchServiceConfigs = async (
  client: ServicesClient,
  project: string,
  region: string,
  services: string[]
) => {
  const existingServiceConfigs: IService[] = []
  for (const serviceName of services) {
    const servicePath = client.servicePath(project, region, serviceName)

    const existingService = await withSpinner(
      `Fetching configuration for ${chalk.bold(serviceName)}...`,
      async () => {
        try {
          const [serv] = await client.getService({name: servicePath})

          return serv
        } catch (error) {
          throw new Error(
            `Service ${serviceName} not found in project ${project}, region ${region}.\n\nNo services were instrumented.\n`
          )
        }
      },
      `Fetched service configuration for ${chalk.bold(serviceName)}`
    )
    existingServiceConfigs.push(existingService)
  }

  return existingServiceConfigs
}
