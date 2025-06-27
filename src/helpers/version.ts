/**
 * Current version of `datadog-ci`.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
export const version = require('../../package.json').version as string

const REGISTRY_URL = 'https://registry.npmjs.org/@datadog/datadog-ci'

export const getLatestVersion = async (): Promise<string> => {
  const response = await fetch(REGISTRY_URL)
  const data = await response.json() as { 'dist-tags': { latest: string } }
  return data['dist-tags'].latest
}
