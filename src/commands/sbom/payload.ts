import * as console from 'console'
import crypto from 'crypto'

import {SpanTags} from '../../helpers/interfaces'
import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '../../helpers/tags'

import {FILE_PACKAGE_PROPERTY_KEY, IS_DEPENDENCY_DIRECT_PROPERTY_KEY, PACKAGE_MANAGER_PROPERTY_KEY, REQUIRED_GIT_TAGS} from './constants'
import {getLanguageFromComponent} from './language'
import {Relations, Dependency, File, Location, LocationFromFile, Locations, ScaRequest} from './types'

// Parse a location from the file generated by osv-scanner into a location that can be
// sent to our API.
const parseLocation = (location: LocationFromFile): undefined | Location => {
  if (!location) {
    return undefined
  }
  if (
    !location.file_name ||
    !location.line_start ||
    !location.line_end ||
    !location.column_start ||
    !location.column_end
  ) {
    return undefined
  }

  if (location.line_end < location.line_start) {
    return undefined
  }

  if (location.line_end === location.line_start && location.column_end <= location.column_start) {
    return undefined
  }

  // check location values
  if (location.line_start <= 0 || location.line_end <= 0 || location.column_start <= 0 || location.column_end <= 0) {
    return undefined
  }

  return {
    file_name: location.file_name,
    start: {
      line: location.line_start,
      col: location.column_start,
    },
    end: {
      line: location.line_end,
      col: location.column_end,
    },
  }
}

// Parse all locations from the OSV scanner. If one fails to be parse, it's set to undefined
const parseLocationsString = (locations: string): undefined | Locations => {
  try {
    const parsed = JSON.parse(locations)

    const res: Locations = {
      block: parseLocation(parsed['block']),
      namespace: parseLocation(parsed['namespace']),
      name: parseLocation(parsed['name']),
      version: parseLocation(parsed['version']),
    }

    // if block is not defined, the API fails and we should rather ignore the payload
    if (!res.block) {
      return undefined
    }

    return res
  } catch (e) {
    console.error(`error when parsing locations: ${e}`)
  }

  return undefined
}

// Generate the payload we send to the API
// jsonContent is the SBOM file content read from disk
// tags are the list of tags we retrieved
export const generatePayload = (
  jsonContent: any,
  tags: SpanTags,
  service: string,
  env: string
): ScaRequest | undefined => {

  if (
    REQUIRED_GIT_TAGS.filter((tag) => !tags[tag]).length > 0
  ) {
    return undefined
  }

  const dependencies: Dependency[] = []
  const files: File[] = []
  const relations: Relations[] = []

  if (jsonContent) {
    if (jsonContent['components']) {
      for (const component of jsonContent['components']) {
        if (!component['type'] || !component['name']) {
          continue
        }

        if (component['type'] === 'library') {
          const dependency = extractingDependency(component)
          if (dependency !== undefined) {
            dependencies.push(dependency)
          }
        } else if (component['type'] === 'file') {
          files.push(extractingFile(component))
        }
      }
    }
    if (jsonContent['dependencies']) {
      for (const dependency of jsonContent['dependencies']) {
        if (!dependency['ref'] || !dependency['dependsOn']) {
          continue
        }
        relations.push(extractingRelations(dependency))
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    commit: {
      author_name: tags[GIT_COMMIT_AUTHOR_NAME],
      author_email: tags[GIT_COMMIT_AUTHOR_EMAIL],
      committer_name: tags[GIT_COMMIT_COMMITTER_NAME],
      committer_email: tags[GIT_COMMIT_COMMITTER_EMAIL],
      sha: tags[GIT_SHA],
      branch: tags[GIT_BRANCH],
    },
    repository: {
      url: tags[GIT_REPOSITORY_URL],
    },
    tags,
    dependencies,
    files,
    relations,
    service,
    env,
  }
}

const extractingDependency = (component: any): Dependency | undefined => {
  const lang = getLanguageFromComponent(component)

  if (!lang) {
    return
  }

  const purl: string | undefined = component['purl']

  if (!purl) {
    console.error(`cannot find purl for component ${component['name']}`)

    return
  }

  const locations: Locations[] = []

  // Extract the unique location strings from the file.
  const locationsStrings: Set<string> = new Set()
  if (component['evidence'] && component['evidence']['occurrences']) {
    for (const occ of component['evidence']['occurrences']) {
      if (occ['location']) {
        const loc: string = occ['location']

        if (!locationsStrings.has(loc)) {
          locationsStrings.add(loc)
        }
      }
    }
  }

  for (const l of locationsStrings) {
    const loc = parseLocationsString(l)
    if (loc) {
      locations.push(loc)
    }
  }

  let packageManager = ''
  let isDirect
  for (const property of component['properties'] ?? []) {
    if (property['name'] === PACKAGE_MANAGER_PROPERTY_KEY) {
      packageManager = property['value']
    } else if (property['name'] === IS_DEPENDENCY_DIRECT_PROPERTY_KEY) {
      isDirect = property['value'].toLowerCase() === 'true' ? true : undefined
    }
  }

  const dependency: Dependency = {
    name: component['name'],
    group: component['group'] || undefined,
    version: component['version'] || undefined,
    language: lang,
    licenses: [],
    purl,
    locations,
    is_direct: isDirect,
    package_manager: packageManager,
  }

  return dependency
}

const extractingFile = (component: any): File => {
  let purl
  for (const property of component['properties'] ?? []) {
    if (property['name'] === FILE_PACKAGE_PROPERTY_KEY) {
      purl = property['value']
    }
  }

  return {
    name: component['name'],
    purl,
  }
}

const extractingRelations = (dependency: any): Relations => {
  return {
    component_ref: dependency['ref'],
    depends_on: dependency['dependsOn'],
  }
}
