import type {WebSiteManagementClient} from '@azure/arm-appservice'
import type {WebApp} from '@datadog/datadog-ci-base/commands/aas/common'

import {httpRequest} from '@datadog/datadog-ci-base/helpers/request'
import {thirdParty} from '@datadog/datadog-ci-base/helpers/request/third-party'

export interface KuduClient {
  deleteDirectory(directory: string): Promise<void>
  publish(directory: string, archive: Buffer): Promise<void>
  hasArtifacts(artifacts: readonly (readonly string[])[]): Promise<boolean>
}

type PublishingCredentials = {
  properties?: {publishingPassword?: string; publishingUserName?: string; scmUri?: string}
}

export const getKuduClient = async (
  client: WebSiteManagementClient,
  resourceGroup: string,
  webApp: WebApp
): Promise<KuduClient> => {
  const credentials = (await (webApp.slot
    ? client.webApps.beginListPublishingCredentialsSlotAndWait(resourceGroup, webApp.name, webApp.slot)
    : client.webApps.beginListPublishingCredentialsAndWait(resourceGroup, webApp.name))) as PublishingCredentials
  const {publishingPassword, publishingUserName, scmUri} = credentials.properties ?? {}
  if (!publishingPassword || !publishingUserName || !scmUri) {
    throw new Error('SCM publishing credentials are unavailable. Enable SCM access and retry.')
  }

  const baseUrl = scmUri.replace(/\/$/, '')
  const authorization = `Basic ${Buffer.from(`${publishingUserName}:${publishingPassword}`).toString('base64')}`
  const request = <T>(method: string, path: string, data?: unknown) =>
    httpRequest<T>({
      method,
      url: thirdParty(`${baseUrl}${path}`),
      headers: {Authorization: authorization},
      data,
      timeout: 120_000,
    })

  return {
    publish: async (directory, archive) => {
      await request('POST', `/api/publish?type=zip&path=${encodeURIComponent(directory)}`, archive)
      for (let attempt = 0; attempt < 60; attempt++) {
        const deployment = await request<{status?: number; complete?: boolean}>('GET', '/api/deployments/latest')
        if (deployment.data.status === 4 || deployment.data.complete) {
          return
        }
        if (deployment.data.status === 3) {
          throw new Error('The SCM deployment failed.')
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

      return result.data.ExitCode === 0
    },
    deleteDirectory: async (directory) => {
      await request('POST', '/api/command', {command: `rm -rf -- ${shellQuote(directory)}`, dir: '/'})
    },
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
