import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {AxiosPromise, AxiosResponse} from 'axios'

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
