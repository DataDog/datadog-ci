import fs from 'fs'
import {pipeline} from 'stream/promises'
import zlib from 'zlib'

import type {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {MultipartPayload, UploadOptions} from '@datadog/datadog-ci-base/helpers/upload'
import type {Transform} from 'stream'

import {getBaseSourcemapIntakeUrl} from '@datadog/datadog-ci-base/helpers/base-intake-url'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {upload} from '@datadog/datadog-ci-base/helpers/upload'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

interface ZstdOptions {
  pledgedSrcSize?: number
  params?: Record<number, number>
}

type ZlibWithZstd = typeof zlib & {
  createZstdCompress?: (options?: ZstdOptions) => Transform
  constants: typeof zlib.constants & {
    ZSTD_c_checksumFlag?: number
  }
}

export const supportsZstdCompression = (): boolean => typeof (zlib as ZlibWithZstd).createZstdCompress === 'function'

export const compressFileWithZstd = async (inputPath: string, outputPath: string): Promise<void> => {
  const zlibWithZstd = zlib as ZlibWithZstd
  const createZstdCompress = zlibWithZstd.createZstdCompress
  if (typeof createZstdCompress !== 'function') {
    throw new Error('zstd compression is not supported in this Node.js version')
  }

  const {size} = await fs.promises.stat(inputPath)
  const options: ZstdOptions = {pledgedSrcSize: size}
  if (zlibWithZstd.constants.ZSTD_c_checksumFlag !== undefined) {
    options.params = {[zlibWithZstd.constants.ZSTD_c_checksumFlag]: 1}
  }

  await pipeline(fs.createReadStream(inputPath), createZstdCompress(options), fs.createWriteStream(outputPath))
}

export const getElfRequestBuilder = (apiKey: string, cliVersion: string, site: string) =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_elf-symbols'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
    overrideUrl: datadogRoute('/api/v2/srcmap'),
  })

// This function exists partially just to make mocking network calls easier.
export const uploadMultipartHelper = async (
  requestBuilder: RequestBuilder,
  payload: MultipartPayload,
  opts: UploadOptions
) => upload(requestBuilder)(payload, opts)
