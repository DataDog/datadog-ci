import {posix} from 'node:path'

import type {WebSiteManagementClient} from '@azure/arm-appservice'
import type {WebApp} from '@datadog/datadog-ci-base/commands/aas/common'

import {DefaultAzureCredential} from '@azure/identity'
import {getProxyDispatcher, httpRequest, isRequestError} from '@datadog/datadog-ci-base/helpers/request'
import {thirdParty} from '@datadog/datadog-ci-base/helpers/request/third-party'

export interface KuduClient {
  /** Waits until the SCM site answers commands, up to the command deadline. */
  waitUntilReady(): Promise<void>
  /** Extracts `archive` into `directory` with a single request, which is never replayed. */
  publish(directory: string, archive: Buffer): Promise<void>
  /** Returns whether every artifact exists. With `waitUntilPresent`, rechecks until the command deadline. */
  hasArtifacts(artifacts: readonly (readonly string[])[], waitUntilPresent?: boolean): Promise<boolean>
  /** Atomically renames `source` to `target`. Fails if `source` is missing or `target` is a non-empty directory. */
  rename(source: string, target: string): Promise<void>
  /**
   * Atomically renames `source` to `target` if `source` exists, retrying until the command deadline,
   * then checks once and returns whether `source` is gone.
   */
  moveAside(source: string, target: string): Promise<boolean>
  /** Deletes the `<path>.tmp-*` siblings of `path`, optionally only those unmodified for `olderThanMinutes`. */
  deleteTemporaryTrees(path: string, olderThanMinutes?: number): Promise<void>
}

type PublishingCredentials = {
  properties?: {publishingPassword?: string; publishingUserName?: string; scmUri?: string}
  publishingPassword?: string
  publishingUserName?: string
  scmUri?: string
}

// The SCM front end answers these when the SCM site doesn't respond, for example while it restarts
// after a settings update (about 46 s on B1).
const RETRYABLE_SCM_STATUSES = new Set([429, 502, 503, 504])

export const isRetryableScmError = (error: unknown): boolean =>
  isRequestError(error) && RETRYABLE_SCM_STATUSES.has(error.response?.status ?? 0)
const SCM_RETRY_INTERVAL_MS = 10_000
const SCM_RETRY_DEADLINE_MS = 180_000
// Retrying every 10 s until a 3-minute deadline covers the SCM restart and the time the restarting
// app holds files on /home with margin. Each command attempt allows 120 s, which covers the slowest
// observed command (65 s to delete a Node.js tracer on B1).
const COMMAND_TIMEOUT_MS = 120_000
// Kudu keeps extracting after a lost response, so `publish` never replays an upload: a replay could
// race the first extraction. On B1, a 400-file zip extracts in at most 93 s with 6 uploads in flight.
const UPLOAD_TIMEOUT_MS = 180_000

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
    data: unknown,
    headers: Record<string, string>,
    timeout: number
  ): Promise<T | undefined> => {
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
      timeout,
    })

    return typeof response.data === 'string'
      ? response.data
        ? (JSON.parse(response.data) as T)
        : undefined
      : (response.data as T)
  }

  // Runs `script` and returns whether it exited 0. `untilReady` retries retryable SCM statuses,
  // `untilSuccess` also retries non-zero exits, and `once` makes a single attempt.
  const runCommand = async (script: string, retry: 'once' | 'untilReady' | 'untilSuccess'): Promise<boolean> => {
    const deadline = Date.now() + SCM_RETRY_DEADLINE_MS
    for (;;) {
      try {
        const result = await request<{ExitCode?: number}>(
          'POST',
          '/api/command',
          {command: `/bin/bash -c "${escapeBashArgument(script)}"`, dir: '/home'},
          {},
          COMMAND_TIMEOUT_MS
        )
        if (result?.ExitCode === 0 || retry !== 'untilSuccess' || Date.now() >= deadline) {
          return result?.ExitCode === 0
        }
      } catch (error) {
        if (retry === 'once' || !isRetryableScmError(error) || Date.now() >= deadline) {
          throw error
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SCM_RETRY_INTERVAL_MS))
    }
  }

  return {
    waitUntilReady: async () => {
      await runCommand('true', 'untilReady')
    },
    publish: async (directory, archive) => {
      // Plain zip extraction via the Kudu zip API. Unlike OneDeploy (/api/publish) this runs no
      // Oryx build (which would compress node_modules into a tarball for Node apps), needs no
      // deployment polling, and creates missing parent directories (/home/data does not exist
      // until the app runtime boots, which races staging on fresh apps).
      const relativePath = directory.replace(/^\/home\//, '')
      await request('PUT', `/api/zip/${relativePath}/`, archive, {'Content-Type': 'application/zip'}, UPLOAD_TIMEOUT_MS)
    },
    hasArtifacts: async (artifacts, waitUntilPresent = false) => {
      // Parenthesize each alternative group: bash && and || are left-associative, so without
      // grouping a passing later artifact would mask a failed earlier one.
      const checks = artifacts
        .map((alternatives) => `( ${alternatives.map((artifact) => `test -f ${shellQuote(artifact)}`).join(' || ')} )`)
        .join(' && ')

      return runCommand(checks, waitUntilPresent ? 'untilSuccess' : 'untilReady')
    },
    rename: async (source, target) => {
      if (!(await runCommand(`mv -T -- ${shellQuote(source)} ${shellQuote(target)}`, 'untilReady'))) {
        throw new Error(`Failed to move ${source} to ${target} on the Web App.`)
      }
    },
    moveAside: async (source, target) => {
      // Renaming fails while the restarting app still holds files in `source`, so retry it.
      const script = `test ! -e ${shellQuote(source)} || mv -T -- ${shellQuote(source)} ${shellQuote(target)}`
      if (!(await runCommand(script, 'untilSuccess'))) {
        throw new Error(`Failed to move ${source} to ${target} on the Web App.`)
      }

      return runCommand(`test ! -e ${shellQuote(source)}`, 'once')
    },
    deleteTemporaryTrees: async (path, olderThanMinutes) => {
      const parent = shellQuote(posix.dirname(path))
      const age = olderThanMinutes === undefined ? '' : ` -mmin +${olderThanMinutes}`
      const script = `test ! -d ${parent} || find ${parent} -mindepth 1 -maxdepth 1 -name ${shellQuote(`${posix.basename(path)}.tmp-*`)}${age} -exec rm -rf {} +`
      if (!(await runCommand(script, 'once'))) {
        throw new Error(`Failed to delete ${path}.tmp-* from the Web App.`)
      }
    },
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const escapeBashArgument = (value: string): string => value.replace(/[\\"$`]/g, '\\$&')
