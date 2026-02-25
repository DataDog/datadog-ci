import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'

import {TerraformArtifactPayload} from './interfaces'

const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://ci-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadTerraformArtifact =
  (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (payload: TerraformArtifactPayload) => {
    const form = new FormData()

    // Build event envelope according to RFC spec
    const event: Record<string, any> = {
      type: 'terraform_artifact',
      track_type: 'ciiac',
      schema_version: '1.0',
      artifact_type: payload.artifactType,
      artifact_format: 'terraform-json',
      artifact_sha256: payload.artifactSha256,
      artifact_size_bytes: payload.artifactSizeBytes,
      ...payload.spanTags,
    }

    // Add repo_id if available
    if (payload.repoId) {
      event.repo_id = payload.repoId
    }

    // Append event JSON
    form.append('event', JSON.stringify(event), {filename: 'event.json'})

    // Append gzipped file content
    const gzippedContent = await gzipContent(payload.fileContent)
    form.append('iac_file', gzippedContent, {
      filename: `${payload.artifactType}.json.gz`,
      contentType: 'application/gzip',
    })

    return request({
      data: form,
      headers: form.getHeaders(),
      maxBodyLength,
      method: 'POST',
      url: 'api/v2/ciiac',
    })
  }

const gzipContent = (content: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const gzip = createGzip()

    gzip.on('data', (chunk) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)

    gzip.write(content)
    gzip.end()
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadTerraformArtifact: uploadTerraformArtifact(requestIntake),
  }
}
