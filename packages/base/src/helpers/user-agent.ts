import {AsyncLocalStorage} from 'node:async_hooks'

import {cliVersion} from '../version'

const pluginUserAgentStorage = new AsyncLocalStorage<string>()

const formatPluginName = (pluginName: string) => pluginName.replace(/^@datadog\//, '')
const formatPluginUserAgent = (pluginName: string, pluginVersion: string) =>
  `${formatPluginName(pluginName)}/${pluginVersion}`

// The user agent has the same format as the one used in the Datadog API client for TypeScript.
// https://github.com/DataDog/datadog-api-client-typescript/blob/507c098afb5224efe8bf4cbcd0e3d84fd2bc4525/userAgent.ts#L5

let baseUserAgent: string
if (typeof process !== 'undefined' && process.release && process.release.name === 'node') {
  baseUserAgent = `datadog-ci/${cliVersion} (node ${process.versions.node}; os ${process.platform}; arch ${process.arch})`
} else {
  baseUserAgent = `datadog-ci/${cliVersion} (runtime unknown)`
}

/**
 * Gets the user agent for requests made by the CLI.
 *
 * @example `datadog-ci/1.0.0 (node 18.17.0; os darwin; arch arm64) datadog-ci-plugin-synthetics/1.0.0`
 * @example `datadog-ci/1.0.0 (runtime unknown) datadog-ci-plugin-synthetics/1.0.0`
 * @example `datadog-ci/1.0.0 (runtime unknown)`
 */
export const getUserAgent = (): string => {
  const activePlugin = pluginUserAgentStorage.getStore()
  if (activePlugin) {
    return `${baseUserAgent} ${activePlugin}`
  }

  return baseUserAgent
}

export const withPluginUserAgent = async <T>(
  pluginName: string,
  pluginVersion: string,
  callback: () => Promise<T>
): Promise<T> => pluginUserAgentStorage.run(formatPluginUserAgent(pluginName, pluginVersion), callback)
