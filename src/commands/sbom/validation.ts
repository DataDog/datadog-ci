import fs from 'fs'

import Ajv, {ErrorObject} from 'ajv'
import addFormats from 'ajv-formats'
import {PackageURL} from 'packageurl-js'

import {CommandContext} from '../../helpers/interfaces'

import cycloneDxSchema14 from './json-schema/cyclonedx/bom-1.4.schema.json'
import cycloneDxSchema15 from './json-schema/cyclonedx/bom-1.5.schema.json'
import cycloneDxSchema16 from './json-schema/cyclonedx/bom-1.6.schema.json'
import jsfSchema from './json-schema/jsf/jsf-0.82.schema.json'
import spdxSchema from './json-schema/spdx/spdx.schema.json'
import {Dependency, DependencyLanguage} from './types'

/**
 * Get the validate function. Read all the schemas and return
 * the function used to validate all SBOM documents.
 */
export const getValidator = (): Ajv => {
  const ajv = new Ajv({strict: false, validateFormats: false})
  ajv.addMetaSchema(spdxSchema)
  ajv.addMetaSchema(jsfSchema)
  addFormats(ajv)

  return ajv
}

interface LogOptions {
  context: CommandContext
  debug: boolean
}

/**
 * Validate an SBOM file against the SBOM CycloneDX schema.
 *
 * @param path - the path of the file to validate
 * @param ajv - an instance of Ajv fully initialized and ready to use.
 * @param logOptions - options for logging
 */
export const validateSbomFileAgainstSchema = (path: string, ajv: Ajv, logOptions: LogOptions): boolean => {
  const {context, debug} = logOptions

  const showValidationErrors = (version: string, errors: ErrorObject[]): void => {
    errors.forEach((message) => {
      context.stderr.write(
        `Error while validating file against CycloneDX ${version}: ${path}, ${message.schemaPath}: ${message.instancePath} ${message.message}\n`
      )
    })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fileContent = JSON.parse(fs.readFileSync(path).toString('utf8'))
    const validateFunctionCycloneDx16 = ajv.compile(cycloneDxSchema16)
    const validateFunctionCycloneDx15 = ajv.compile(cycloneDxSchema15)
    const validateFunctionCycloneDx14 = ajv.compile(cycloneDxSchema14)

    const isValid16 = validateFunctionCycloneDx16(fileContent)
    const isValid15 = validateFunctionCycloneDx15(fileContent)
    const isValid14 = validateFunctionCycloneDx14(fileContent)

    // if debug is set, we should show what version is valid, either CycloneDX 1.4 or 1.5
    if (isValid16 && debug) {
      context.stdout.write('File is a valid CycloneDX 1.6 file\n')
    }

    if (isValid15 && debug) {
      context.stdout.write('File is a valid CycloneDX 1.5 file\n')
    }

    if (isValid14 && debug) {
      context.stdout.write('File is a valid CycloneDX 1.4 file\n')
    }

    if (isValid14 || isValid15 || isValid16) {
      return true
    }

    // show the errors
    if (!isValid16) {
      if (debug) {
        showValidationErrors('1.6', validateFunctionCycloneDx16.errors || [])
      }
    }

    // show the errors
    if (!isValid15) {
      showValidationErrors('1.5', validateFunctionCycloneDx15.errors || [])
    }

    if (!isValid14) {
      if (debug) {
        showValidationErrors('1.4', validateFunctionCycloneDx14.errors || [])
      }
    }

    return false
  } catch (error) {
    if (debug) {
      context.stderr.write(`Error while reading file: ${error.message}\n`)
    }

    return false
  }
}

/**
 * Validate an SBOM file again what we need.
 * @param path - the path of the file to validate
 * @param logOptions - options for logging
 */
export const validateFileAgainstToolRequirements = (path: string, logOptions: LogOptions): boolean => {
  const {context, debug} = logOptions

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fileContent = JSON.parse(fs.readFileSync(path).toString('utf8'))
    if (!fileContent) {
      return false
    }

    const components = fileContent['components']

    if (!components) {
      return true
    }

    for (const component of components) {
      if (!component['type']) {
        return false
      }

      if (component['type'] === 'library') {
        const name = component['name']

        if (!component['version']) {
          continue
        }

        if (!component['purl']) {
          if (debug) {
            context.stderr.write(`Component ${name} has no purl\n`)
          }

          return false
        }
      }
    }
  } catch (error) {
    if (debug) {
      context.stderr.write(`Error while reading file: ${error.message}\n`)
    }

    return false
  }

  return true
}

/**
 * Filter invalid dependencies if some data is not compliant to what we expect.
 * @param dependencies
 */
export const filterInvalidDependencies = (dependencies: Dependency[], logOptions: LogOptions): Dependency[] => {
  const {context} = logOptions
  const filteredDependencies: Dependency[] = []

  for (const dep of dependencies) {
    let isValid = true
    try {
      PackageURL.fromString(dep.purl)
    } catch (purlError) {
      isValid = false
      context.stderr.write(`invalid purl ${dep.purl} for component ${dep.name}\n`)
    }
    if (isValid) {
      filteredDependencies.push(dep)
    }
  }

  return filteredDependencies
}

const pythonPackageNameRegex = new RegExp('^[a-zA-Z0-9][a-zA-Z0-9\\-_.]*[a-zA-Z0-9]$')

export const validateDependencyName = (dependency: Dependency): boolean => {
  if (dependency.language === DependencyLanguage.PYTHON && !pythonPackageNameRegex.test(dependency.name)) {
    return false
  }

  return true
}
