import crypto from 'crypto'

import {SpanTags} from '../../helpers/interfaces'
import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '../../helpers/tags'

import {getLanguageFromComponent} from './language'
import {getLicensesFromComponent} from './license'
import {Dependency, ScaRequest} from './types'

// Generate the payload we send to the API
// jsonContent is the SBOM file content read from disk
// tags are the list of tags we retrieved
export const generatePayload = (jsonContent: any, tags: SpanTags): ScaRequest | undefined => {
  if (
    !tags[GIT_COMMIT_AUTHOR_EMAIL] ||
    !tags[GIT_COMMIT_AUTHOR_NAME] ||
    !tags[GIT_SHA] ||
    !tags[GIT_BRANCH] ||
    !tags[GIT_REPOSITORY_URL]
  ) {
    return undefined
  }

  const dependencies: Dependency[] = []

  if (jsonContent) {
    if (jsonContent['components']) {
      for (const component of jsonContent['components']) {
        if (!component['type'] || !component['name'] || !component['version']) {
          continue
        }
        if (component['type'] !== 'library') {
          continue
        }

        const lang = getLanguageFromComponent(component)

        if (!lang) {
          continue
        }

        const dependency: Dependency = {
          name: component['name'],
          version: component['version'],
          language: lang,
          licenses: getLicensesFromComponent(component),
        }
        dependencies.push(dependency)
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    commit: {
      author_name: tags[GIT_COMMIT_AUTHOR_NAME],
      author_email: tags[GIT_COMMIT_AUTHOR_EMAIL],
      sha: tags[GIT_SHA],
      branch: tags[GIT_BRANCH],
    },
    repository: {
      url: tags[GIT_REPOSITORY_URL],
    },
    tags,
    dependencies,
  }
}
