import type {RepositoryData} from './format-git-sourcemaps-data'
import type {MultipartValue} from '../upload'

// Builds the 'repository' multipart value sent along symbol uploads.
// It contains every tracked file of the repository, so it can be large: build it once per command run
// and reuse it for every uploaded file.
export const getRepositoryMultipartValue = (gitData: RepositoryData): MultipartValue => {
  const repoPayload = {
    data: [
      {
        files: gitData.trackedFilesMatcher.rawTrackedFilesList(),
        hash: gitData.hash,
        repository_url: gitData.remote,
      },
    ],
    version: 1,
  }

  return {
    type: 'string',
    options: {filename: 'repository', contentType: 'application/json'},
    value: JSON.stringify(repoPayload),
  }
}
