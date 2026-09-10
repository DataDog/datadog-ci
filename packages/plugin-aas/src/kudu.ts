import type {WebSiteManagementClient} from '@azure/arm-appservice'
import type {WebApp} from '@datadog/datadog-ci-base/commands/aas/common'

import {getProxyDispatcher, httpRequest} from '@datadog/datadog-ci-base/helpers/request'
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

// Kudu deployment status values: https://github.com/Azure/functions-action/blob/main/src/appservice-rest/Kudu/azure-app-kudu-service.ts
const KUDU_DEPLOYMENT_STATUS = {
  FAILED: 3,
  SUCCESS: 4,
} as const

export const getKuduClient = async (
  client: WebSiteManagementClient,
  resourceGroup: string,
  webApp: WebApp
): Promise<KuduClient> => {
  const credentials = (await (webApp.slot
    ? client.webApps.beginListPublishingCredentialsSlotAndWait(resourceGroup, webApp.name, webApp.slot)
    : client.webApps.beginListPublishingCredentialsAndWait(resourceGroup, webApp.name))) as PublishingCredentials
  const {publishingPassword, publishingUserName, scmUri} = credentials.properties ?? credentials
  if (!publishingPassword || !publishingUserName || !scmUri) {
    throw new Error('SCM publishing credentials are unavailable. Enable SCM access and retry.')
  }

  const scmUrl = new URL(scmUri)
  scmUrl.username = ''
  scmUrl.password = ''
  const baseUrl = scmUrl.toString().replace(/\/$/, '')
  const authorization = `Basic ${Buffer.from(`${publishingUserName}:${publishingPassword}`).toString('base64')}`
  const request = async <T>(method: string, path: string, data?: unknown): Promise<{data: T | undefined}> => {
    const response = await httpRequest<string>({
      method,
      url: thirdParty(`${baseUrl}${path}`),
      headers: {Authorization: authorization},
      data,
      dispatcher: getProxyDispatcher(),
      timeout: 120_000,
    })

    const parsedData =
      typeof response.data === 'string'
        ? response.data
          ? (JSON.parse(response.data) as T)
          : undefined
        : (response.data as T)

    return {data: parsedData}
  }

  return {
    publish: async (directory, archive) => {
      await request('POST', `/api/publish?type=zip&path=${encodeURIComponent(directory)}`, archive)
      for (let attempt = 0; attempt < 60; attempt++) {
        const deployment = await request<{status?: number; complete?: boolean}>('GET', '/api/deployments/latest')
        if (deployment.data?.status === KUDU_DEPLOYMENT_STATUS.FAILED) {
          throw new Error('The SCM deployment failed.')
        }
        if (deployment.data?.status === KUDU_DEPLOYMENT_STATUS.SUCCESS) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      throw new Error('Timed out waiting for the SCM deployment.')
    },
    hasArtifacts: async (artifacts) => {
      const checks = artifacts
        .map((alternatives) => `(${alternatives.map((artifact) => `[ -f ${shellQuote(artifact)} ]`).join(' || ')})`)
        .join(' && ')
      const result = await request<{ExitCode?: number}>('POST', '/api/command', {command: checks, dir: '/'})

      return result.data?.ExitCode === 0
    },
    deleteDirectory: async (directory) => {
      await request('POST', '/api/command', {command: `rm -rf -- ${shellQuote(directory)}`, dir: '/'})
    },
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
