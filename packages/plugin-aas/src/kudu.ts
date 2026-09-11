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
    headers: Record<string, string> = {}
  ): Promise<{data: T | undefined; headers: Record<string, string>}> => {
    const token = await azureCredential.getToken('https://management.azure.com/.default')
    if (!token) {
      throw new Error('Azure credentials could not access the SCM site.')
    }
    const response = await httpRequest<string>({
      method,
      url: thirdParty(`${baseUrl}${path}`),
      headers: {Authorization: `Bearer ${token.token}`, ...headers},
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

    return {data: parsedData, headers: response.headers}
  }

  return {
    publish: async (directory, archive) => {
      // Kudu answers 404 for deployment queries when the app has no deployments yet (e.g. code
      // uploaded via VFS), so treat 404 as "no deployment visible" instead of failing the publish.
      const getDeployment = async (path: string) => {
        try {
          return await request<{id?: string; status?: number; status_text?: string}>('GET', path)
        } catch (error) {
          if (isRequestError(error) && error.response?.status === 404) {
            return {data: undefined, headers: {}}
          }
          throw error
        }
      }
      const getDeploymentLog = async (id: string | undefined): Promise<string> => {
        if (!id) {
          return ''
        }
        try {
          const {data} = await request<{message?: string}[]>('GET', `/api/deployments/${id}/log`)
          const messages = (data ?? [])
            .map((entry) => entry.message)
            .filter(Boolean)
            .slice(-5)

          return messages.length > 0 ? ` Log: ${messages.join(' | ')}` : ''
        } catch {
          return ''
        }
      }
      const previousDeployment = await getDeployment('/api/deployments/latest')
      const publishResponse = await request(
        'POST',
        `/api/publish?type=zip&path=${encodeURIComponent(directory)}&clean=false&restart=false&async=true`,
        archive,
        {
          'Content-Type': 'application/zip',
        }
      )
      const deploymentPath = publishResponse.headers.location
        ? (() => {
            const location = new URL(publishResponse.headers.location)

            return `${location.pathname}${location.search}`
          })()
        : '/api/deployments/latest'
      // OneDeploy extracts the tracer onto the Azure Files-backed /home mount, which can take
      // well over ten minutes when the App Service plan is busy, so poll generously.
      let lastStatus: string | undefined
      for (let attempt = 0; attempt < 600; attempt++) {
        const deployment = await getDeployment(deploymentPath)
        if (!publishResponse.headers.location && deployment.data?.id === previousDeployment.data?.id) {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          continue
        }
        lastStatus = deployment.data?.status_text ?? lastStatus
        if (deployment.data?.status === KUDU_DEPLOYMENT_STATUS.FAILED) {
          throw new Error(`The SCM deployment failed.${await getDeploymentLog(deployment.data?.id)}`)
        }
        if (deployment.data?.status === KUDU_DEPLOYMENT_STATUS.SUCCESS) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      throw new Error(`Timed out waiting for the SCM deployment.${lastStatus ? ` Last status: ${lastStatus}` : ''}`)
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
