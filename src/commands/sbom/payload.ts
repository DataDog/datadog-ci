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

// Attempt to find the language from a SBOM component. For now, we get the source either from
// the bom-ref or the purl property of the SBOM.
const getLanguageFromComponent = (component: any): DependencyLanguage | undefined => {
  const componentName = component['name']

  if (component['bom-ref']) {
    if (component['bom-ref'].indexOf('pkg:npm') !== -1) {
      return DependencyLanguage.NPM
    }
    if (component['purl'].indexOf('pkg:composer') !== -1) {
      return DependencyLanguage.PHP
    }
    if (component['purl'].indexOf('pkg:cargo') !== -1) {
      return DependencyLanguage.RUST
    }
  }

  console.debug(`language for component ${componentName} not found`)

  return undefined
}

// Get the license from a string. If the license is valid, we return it. Otherwise, we return undefined
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
    case 'BSL-1.0':
      return DependencyLicense.BSL1
    case 'ISC':
      return DependencyLicense.ISC
    case 'MIT':
      return DependencyLicense.MIT
    case 'Zlib':
      return DependencyLicense.ZLIB
  }

  console.debug(`license ${s} not recognized`)

  return undefined
}

// Get all the licenses from a string. Sometimes, there are two licenses in one string
// such as "MIT OR Apache-2.0". In this case, we return all the licenses in this condition.
const getLicensesFromString = (s: string): DependencyLicense[] => {
  if (!s) {
    return []
  }
  const licenses: DependencyLicense[] = []

  if (s.indexOf('OR') !== -1) {
    for (const lic of s.split(' OR ')) {
      const l = getLicenseFromString(lic.replace(' ', ''))
      if (l) {
        licenses.push(l)
      }
    }
  } else {
    const lic = getLicenseFromString(s)
    if (lic) {
      licenses.push(lic)
    }
  }

  return licenses
}

// Get all the licenses of this component We extract the "licenses" element from the SBOM component.
// Unfortunately, depending on the SBOM generator, the licenses are generated in a different manner.
// We attempt to get as much as possible.
const getLicensesFromComponent = (component: any): DependencyLicense[] => {
  const elementsForLicense = ['id', 'name']

  const componentName = component['name']
  const licenses: DependencyLicense[] = []

  // Get the "licenses" attribute of the SBOM component.
  if (component['licenses']) {
    for (const license of component['licenses']) {
      for (const el of elementsForLicense) {
        // Handle "license": [ {"license": {"id": <license>}}]
        if (license['license'] && license['license'][el]) {
          for (const l of getLicensesFromString(license['license'][el])) {
            licenses.push(l)
          }
        }

        // Handle "license": [ {"expression": "MIT"}]
        if (license['expression']) {
          for (const l of getLicensesFromString(license['expression'])) {
            licenses.push(l)
          }
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
