import type {WebSiteManagementClient} from '@azure/arm-appservice'
import type {WebApp} from '@datadog/datadog-ci-base/commands/aas/common'

import {DefaultAzureCredential} from '@azure/identity'
import {getProxyDispatcher, httpRequest, isRequestError} from '@datadog/datadog-ci-base/helpers/request'
import {thirdParty} from '@datadog/datadog-ci-base/helpers/request/third-party'

export interface KuduClient {
  deleteDirectory(directory: string): Promise<void>
  publish(directory: string, archive: Buffer): Promise<void>
  hasArtifacts(artifacts: readonly (readonly string[])[]): Promise<boolean>
}

type PublishingCredentials = {
  properties?: {publishingPassword?: string; publishingUserName?: string; scmUri?: string}
  publishingPassword?: string
  publishingUserName?: string
  scmUri?: string
}

const RETRYABLE_SCM_STATUSES = new Set([429, 502, 503])

export const getKuduClient = async (
  client: WebSiteManagementClient,
  resourceGroup: string,
  webApp: WebApp
): Promise<KuduClient> => {
  const credentials = (await (webApp.slot
    ? client.webApps.beginListPublishingCredentialsSlotAndWait(resourceGroup, webApp.name, webApp.slot)
    : client.webApps.beginListPublishingCredentialsAndWait(resourceGroup, webApp.name))) as PublishingCredentials
  const {scmUri} = credentials.properties ?? credentials
  if (!scmUri) {
    throw new Error('SCM URL is unavailable. Enable SCM access and retry.')
  }

  const scmUrl = new URL(scmUri)
  scmUrl.username = ''
  scmUrl.password = ''
  const baseUrl = scmUrl.toString().replace(/\/$/, '')
  const azureCredential = new DefaultAzureCredential()
  const request = async <T>(
    method: string,
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
    timeout = 120_000
  ): Promise<{data: T | undefined; headers: Record<string, string>}> => {
    const token = await azureCredential.getToken('https://management.azure.com/.default')
    if (!token) {
      throw new Error('Azure credentials could not access the SCM site.')
    }
    // The SCM site answers 502/503/429 while it is still cold (for example right after an app
    // restart), so retry those with backoff instead of failing the run.
    let response
    for (let attempt = 0; ; attempt++) {
      try {
        response = await httpRequest<string>({
          method,
          url: thirdParty(`${baseUrl}${path}`),
          headers: {Authorization: `Bearer ${token.token}`, ...headers},
          data,
          dispatcher: getProxyDispatcher(),
          timeout,
        })
        break
      } catch (error) {
        const status = isRequestError(error) ? error.response?.status : undefined
        if (attempt < 5 && status !== undefined && RETRYABLE_SCM_STATUSES.has(status)) {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          continue
        }
        throw error
      }
    }

    const parsedData =
      typeof response.data === 'string'
        ? response.data
          ? (JSON.parse(response.data) as T)
          : undefined
        : (response.data as T)

    return {data: parsedData, headers: response.headers}
  }

  return {
    publish: async (directory, archive) => {
      // Plain zip extraction via the Kudu zip API. Unlike OneDeploy (/api/publish) this runs no
      // Oryx build (which would compress node_modules into a tarball for Node apps), needs no
      // deployment polling, and creates missing parent directories (/home/data does not exist
      // until the app runtime boots, which races staging on fresh apps).
      const relativePath = directory.replace(/^\/home\//, '')
      await request('PUT', `/api/zip/${relativePath}/`, archive, {'Content-Type': 'application/zip'}, 600_000)
    },
    hasArtifacts: async (artifacts) => {
      const checks = artifacts
        .map((alternatives) => alternatives.map((artifact) => `test -f ${shellQuote(artifact)}`).join(' || '))
        .join(' && ')
      const result = await request<{ExitCode?: number}>('POST', '/api/command', {
        command: `/bin/bash -c "${escapeBashArgument(checks)}"`,
        dir: '/home',
      })

      return result.data?.ExitCode === 0
    },
    deleteDirectory: async (directory) => {
      await request('POST', '/api/command', {
        command: `/bin/bash -c "${escapeBashArgument(`rm -rf -- ${directory}`)}"`,
        dir: '/home',
      })
    },
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const escapeBashArgument = (value: string): string => value.replace(/[\\"$`]/g, '\\$&')
