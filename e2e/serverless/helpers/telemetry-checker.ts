import type {client} from '@datadog/datadog-api-client'

import {v2} from '@datadog/datadog-api-client'

import {createE2EConfiguration} from '../../helpers/api-client'

const POLL_INTERVAL_SECONDS = 15
const MAX_ATTEMPTS = 20

interface TelemetryIdentity {
  serviceName: string
  env?: string
  version?: string
  tags?: string[]
}

const waitFor = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

const pollUntilFound = async (label: string, query: () => Promise<unknown[]>): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${label}] attempt ${attempt}/${MAX_ATTEMPTS}`)
    try {
      const results = await query()
      if (results.length > 0) {
        console.log(`[${label}] found ${results.length} item(s)`)

        return
      }
    } catch (error) {
      console.error(`[${label}] query error:`, error)
    }

    if (attempt < MAX_ATTEMPTS) {
      console.log(`[${label}] not found, retrying in ${POLL_INTERVAL_SECONDS}s`)
      await waitFor(POLL_INTERVAL_SECONDS)
    }
  }
  throw new Error(`[${label}] timed out after ${MAX_ATTEMPTS} attempts (${MAX_ATTEMPTS * POLL_INTERVAL_SECONDS}s)`)
}

const buildQuery = (
  identity: TelemetryIdentity,
  {servicePrefix, versionPrefix, tagPrefix}: {servicePrefix: '' | '@'; versionPrefix: '' | '@'; tagPrefix: '' | '@'}
): string => {
  const queryParts = [`${servicePrefix}service:${identity.serviceName}`]
  if (identity.env) {
    queryParts.push(`env:${identity.env}`)
  }
  if (identity.version) {
    queryParts.push(`${versionPrefix}version:${identity.version}`)
  }
  for (const tag of identity.tags ?? []) {
    queryParts.push(`${tagPrefix}${tag}`)
  }

  return queryParts.join(' ')
}

const querySpans = async (configuration: client.Configuration, identity: TelemetryIdentity): Promise<unknown[]> => {
  const api = new v2.SpansApi(configuration)
  const now = new Date()
  const from = new Date(now.getTime() - 15 * 60 * 1000)
  const response = await api.listSpans({
    body: {
      data: {
        attributes: {
          filter: {
            query: buildQuery(identity, {servicePrefix: '@', versionPrefix: '@', tagPrefix: '@'}),
            from: from.toISOString(),
            to: now.toISOString(),
          },
          page: {limit: 5},
        },
        type: 'search_request',
      },
    },
  })

  return response.data ?? []
}

const queryLogs = async (configuration: client.Configuration, identity: TelemetryIdentity): Promise<unknown[]> => {
  const api = new v2.LogsApi(configuration)
  const now = new Date()
  const from = new Date(now.getTime() - 15 * 60 * 1000)
  const response = await api.listLogs({
    body: {
      filter: {
        query: buildQuery(identity, {servicePrefix: '', versionPrefix: '', tagPrefix: ''}),
        from: from.toISOString(),
        to: now.toISOString(),
      },
      page: {limit: 5},
    },
  })

  return response.data ?? []
}

export const checkTelemetryFlowing = async (
  identity: TelemetryIdentity,
  // Some platforms (e.g. Windows App Service) don't support log collection, so callers can
  // assert traces only.
  {checkLogs = true}: {checkLogs?: boolean} = {}
): Promise<void> => {
  const configuration = createE2EConfiguration({
    apiKeyAuth: process.env.DATADOG_API_KEY,
    appKeyAuth: process.env.DATADOG_APP_KEY,
  })
  const checks = [pollUntilFound('spans', () => querySpans(configuration, identity))]
  if (checkLogs) {
    checks.push(pollUntilFound('logs', () => queryLogs(configuration, identity)))
  }
  await Promise.all(checks)
}
