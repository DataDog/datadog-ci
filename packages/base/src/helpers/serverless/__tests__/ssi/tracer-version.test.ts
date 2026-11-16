import {getRequestError} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as request from '@datadog/datadog-ci-base/helpers/request'
import {checkPinnedTracerVersion} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer-version'

const singleLanguage = (image: string) => ({kind: 'single-language', spec: {image}})

describe('checkPinnedTracerVersion', () => {
  let httpRequest: jest.SpyInstance

  beforeEach(() => {
    httpRequest = jest.spyOn(request, 'httpRequest').mockResolvedValue({data: {token: 'anonymous'}} as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test.each([
    ['an unpinned version', singleLanguage('gcr.io/datadoghq/dd-lib-js-init:latest')],
    ['the composite image', {kind: 'multi-language', spec: {image: 'gcr.io/datadoghq/dd-lib-init:1'}}],
    ['no injection', {kind: 'no-injection'}],
  ])('makes no request for %s', async (_, config) => {
    await expect(checkPinnedTracerVersion(config)).resolves.toEqual({kind: 'ok'})
    expect(httpRequest).not.toHaveBeenCalled()
  })

  test('accepts a published version', async () => {
    await expect(checkPinnedTracerVersion(singleLanguage('gcr.io/datadoghq/dd-lib-js-init:5.1.0'))).resolves.toEqual({
      kind: 'ok',
    })
    expect(httpRequest).toHaveBeenCalledTimes(1)
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'HEAD',
        url: 'https://gcr.io/v2/datadoghq/dd-lib-js-init/manifests/5.1.0',
      })
    )
  })

  test.each([
    [
      'public.ecr.aws/datadog/dd-lib-js-init:5.1.0',
      'https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository:datadog/dd-lib-js-init:pull',
      'https://public.ecr.aws/v2/datadog/dd-lib-js-init/manifests/5.1.0',
    ],
    [
      'datadoghq.azurecr.io/dd-lib-js-init:5.1.0',
      'https://datadoghq.azurecr.io/oauth2/token?service=datadoghq.azurecr.io&scope=repository:dd-lib-js-init:pull',
      'https://datadoghq.azurecr.io/v2/dd-lib-js-init/manifests/5.1.0',
    ],
  ])('checks %s with an anonymous pull token', async (image, tokenUrl, manifestUrl) => {
    await checkPinnedTracerVersion(singleLanguage(image))

    expect(httpRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({method: 'GET', url: tokenUrl}))
    expect(httpRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'HEAD',
        url: manifestUrl,
        headers: expect.objectContaining({Authorization: 'Bearer anonymous'}),
      })
    )
  })

  test('rejects a version the registry does not have', async () => {
    httpRequest.mockRejectedValue(getRequestError(404, {}))

    await expect(checkPinnedTracerVersion(singleLanguage('gcr.io/datadoghq/dd-lib-js-init:99.0.0'))).resolves.toEqual({
      kind: 'not-found',
      message:
        'Tracer version 99.0.0 was not found in gcr.io/datadoghq/dd-lib-js-init. Set --tracer-version to a published version.',
    })
  })

  test('warns and continues when the anonymous token request returns 404', async () => {
    httpRequest.mockRejectedValue(getRequestError(404, {message: 'Request failed with status code 404'}))

    await expect(
      checkPinnedTracerVersion(singleLanguage('public.ecr.aws/datadog/dd-lib-js-init:5.1.0'))
    ).resolves.toEqual({
      kind: 'unverified',
      message:
        'Could not verify that tracer version 5.1.0 exists in public.ecr.aws/datadog/dd-lib-js-init: Request failed with status code 404. Continuing without the check.',
    })
    expect(httpRequest).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['a network failure', new Error('getaddrinfo ENOTFOUND gcr.io')],
    ['a registry error', getRequestError(503, {message: 'Request failed with status code 503'})],
  ])('warns and continues on %s', async (_, error) => {
    httpRequest.mockRejectedValue(error)

    await expect(checkPinnedTracerVersion(singleLanguage('gcr.io/datadoghq/dd-lib-js-init:5.1.0'))).resolves.toEqual({
      kind: 'unverified',
      message: `Could not verify that tracer version 5.1.0 exists in gcr.io/datadoghq/dd-lib-js-init: ${error.message}. Continuing without the check.`,
    })
  })
})
