import {v2} from '@datadog/datadog-api-client'

import {createE2EConfiguration} from './api-client'

const CHECK_INTERVAL_SECONDS = 10
const MAX_NUM_ATTEMPTS = 10

interface CheckSourcemapsUploadOptions {
  service: string
  version: string
}

const waitFor = (waitSeconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
}

export const checkSourcemapsUpload = async (options: CheckSourcemapsUploadOptions): Promise<void> => {
  const {service, version} = options

  // Sourcemaps are uploaded with the DATADOG_* keys (e2e org), whereas DD_* keys point to the CI Visibility org.
  const configuration = createE2EConfiguration({
    apiKeyAuth: process.env.DATADOG_API_KEY,
    appKeyAuth: process.env.DATADOG_APP_KEY,
  })
  configuration.unstableOperations['v2.listSourcemaps'] = true
  const apiInstance = new v2.RUMApi(configuration)

  let numAttempts = 0
  let data: unknown[] = []

  while (numAttempts++ < MAX_NUM_ATTEMPTS) {
    console.log(`Querying sourcemaps with service:${service} version:${version}.`)

    try {
      const response = await apiInstance.listSourcemaps({
        mapkind: 'js',
        filterService: [service],
        filterVersion: [version],
        pageSize: 5,
      })
      data = response.data || []
    } catch (error) {
      console.error(error)
      data = []
    }

    if (data.length > 0) {
      console.log(`Successful check: the API returned ${data.length} sourcemaps.`)

      return
    }

    const isLastAttempt = numAttempts === MAX_NUM_ATTEMPTS
    if (!isLastAttempt) {
      console.log(`Attempt number ${numAttempts} failed, retrying in ${CHECK_INTERVAL_SECONDS} seconds.`)
      await waitFor(CHECK_INTERVAL_SECONDS)
    }
  }

  throw new Error(`Failed check: the API did not return any sourcemaps for service:${service} version:${version}`)
}
