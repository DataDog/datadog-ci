import crypto from 'crypto'

import {SpanTags} from '../../helpers/interfaces'
import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '../../helpers/tags'

import {Dependency, DependencyLanguage, DependencyLicense, ScaRequest} from './types'

const getLanguageFromComponent = (component: any): DependencyLanguage | undefined => {
  const componentName = component['name']

  if (component['bom-ref']) {
    if (component['bom-ref'].indexOf('pkg:npm') !== -1) {
      return DependencyLanguage.NPM
    }
    if (component['purl'].indexOf('pkg:composer') !== -1) {
      return DependencyLanguage.PHP
    }
  }

  console.log(`language for component ${componentName} not found`)

  return undefined
}

const getLicenseFromString = (s: string): DependencyLicense | undefined => {
  if (!s) {
    return undefined
  }

  switch (s) {
    case '0BSD':
      return DependencyLicense.ZEROBSD
    case 'Apache-2.0':
      return DependencyLicense.APACHE2
    case 'BSD-2-Clause':
      return DependencyLicense.BSD2CLAUSE
    case 'BSD-3-Clause':
      return DependencyLicense.BSD3CLAUSE
    case 'ISC':
      return DependencyLicense.ISC
    case 'MIT':
      return DependencyLicense.MIT
  }

  console.log(`license ${s} not recognized`)

  return undefined
}

const getLicensesFromComponent = (component: any): DependencyLicense[] => {
  const componentName = component['name']
  const licenses: DependencyLicense[] = []
  if (component['licenses']) {
    for (const license of component['licenses']) {
      if (license['license'] && license['license']['id']) {
        const li = getLicenseFromString(license['license']['id'])
        if (li) {
          licenses.push(li)
        }
      }
      if (license['license'] && license['license']['name']) {
        const li = getLicenseFromString(license['license']['name'])
        if (li) {
          licenses.push(li)
        }
      }
    }
  }

  if (licenses.length === 0) {
    console.log(`license for component ${componentName} not found`)
  }

  return licenses
}

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
          return
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
