import fs from 'fs'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import {PackageURL} from 'packageurl-js'

import cycloneDxSchema14 from './json-schema/cyclonedx/bom-1.4.schema.json'
import cycloneDxSchema15 from './json-schema/cyclonedx/bom-1.5.schema.json'
import jsfSchema from './json-schema/jsf/jsf-0.82.schema.json'
import spdxSchema from './json-schema/spdx/spdx.schema.json'

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

/**
 * Validate an SBOM file against the SBOM CycloneDX schema.
 *
 * @param path - the path of the file to validate
 * @param ajv - an instance of Ajv fully initialized and ready to use.
 * @param debug - if we need to show debug information
 */
export const validateSbomFileAgainstSchema = (path: string, ajv: Ajv, debug: boolean): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fileContent = JSON.parse(fs.readFileSync(path).toString('utf8'))
    const validateFunctionCycloneDx15 = ajv.compile(cycloneDxSchema15)
    const validateFunctionCycloneDx14 = ajv.compile(cycloneDxSchema14)

    const isValid15 = validateFunctionCycloneDx15(fileContent)
    const isValid14 = validateFunctionCycloneDx14(fileContent)

    // if debug is set, we should show what version is valid, either CycloneDX 1.4 or 1.5
    if (isValid15 && debug) {
      process.stdout.write('File is a valid CycloneDX 1.5 file\n')
    }

    if (isValid14 && debug) {
      process.stdout.write('File is a valid CycloneDX 1.4 file\n')
    }

    if (isValid14 || isValid15) {
      return true
    }

    // show the errors
    if (!isValid15) {
      const errors15 = validateFunctionCycloneDx15.errors || []

      if (debug) {
        errors15.forEach((message) => {
          process.stderr.write(
            `Error while validating file against CycloneDX 1.5: ${path}, ${message.schemaPath}: ${message.instancePath} ${message.message}\n`
          )
        })
      }
    }

    if (!isValid14) {
      const errors14 = validateFunctionCycloneDx14.errors || []

      if (debug) {
        errors14.forEach((message) => {
          process.stderr.write(
            `Error while validating file against CycloneDX 1.4: ${path}, ${message.schemaPath}: ${message.instancePath} ${message.message}\n`
          )
        })
      }
    }

    return false
  } catch (error) {
    if (debug) {
      process.stderr.write(`Error while reading file: ${error.message}\n`)
    }

    return false
  }
}

/**
 * Validate an SBOM file again what we need.
 * @param path - the path of the file to validate
 * @param debug - if we need to show debug information
 */
export const validateFileAgainstToolRequirements = (path: string, debug: boolean): boolean => {
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
            process.stderr.write(`Component ${name} has no purl\n`)
          }

          return false
        } else {
          try {
            PackageURL.fromString(component['purl'])
          } catch (purlError) {
            process.stderr.write(
              `invalid purl ${component['purl']} for component ${component['name']}: ${purlError.message}\n`
            )

            return false
          }
        }
      }
    }
  } catch (error) {
    if (debug) {
      process.stderr.write(`Error while reading file: ${error.message}\n`)
    }

    return false
  }

  return true
}
