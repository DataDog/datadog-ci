import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

export interface TerraformArtifactPayload {
  artifactType: 'plan' | 'state'
  filePath: string
  fileContent: string
  artifactSha256: string
  artifactSizeBytes: number
  spanTags: SpanTags
  repoId?: string
}

export interface APIHelper {
  uploadTerraformArtifact(payload: TerraformArtifactPayload): AxiosPromise<AxiosResponse>
}
