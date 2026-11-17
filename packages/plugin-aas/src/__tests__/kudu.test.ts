import type {WebSiteManagementClient} from '@azure/arm-appservice'

import {getRequestError} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {httpRequest} from '@datadog/datadog-ci-base/helpers/request'

import {getKuduClient} from '../kudu'

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({getToken: async () => ({token: 'token'})})),
}))

jest.mock('@datadog/datadog-ci-base/helpers/request', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/request'),
  httpRequest: jest.fn(),
}))

const client = {
  webApps: {beginListPublishingCredentialsAndWait: async () => ({scmUri: 'https://my-web-app.scm.azurewebsites.net'})},
} as unknown as WebSiteManagementClient

describe('getKuduClient publish', () => {
  test('does not replay an upload whose response the gateway lost', async () => {
    jest.mocked(httpRequest).mockRejectedValue(getRequestError(504, {}))
    const kudu = await getKuduClient(client, 'my-resource-group', {name: 'my-web-app'} as never)

    await expect(kudu.publish('/home/data/tracer.tmp-1', Buffer.from('zip'))).rejects.toThrow()
    expect(httpRequest).toHaveBeenCalledTimes(1)
  })
})
