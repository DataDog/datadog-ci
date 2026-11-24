import type {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'

import {getBaseSourcemapIntakeUrl} from '@datadog/datadog-ci-base/helpers/base-intake-url'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

export const getAndroidSymbolsRequestBuilder = (apiKey: string, cliVersion: string, site: string): RequestBuilder =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_android-symbols'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
    overrideUrl: datadogRoute('/api/v2/srcmap'),
  })
