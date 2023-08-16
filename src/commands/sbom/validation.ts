import fs from 'fs'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import cycloneDxSchema from './json-schema/cyclonedx/bom-1.4.schema.json'
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
 * Validate an SBOM file.
 * @param path - the path of the file to validate
 * @param ajv - an instance of Ajv fully initialized and ready to use.
 */
export const validateSbomFile = (path: string, ajv: Ajv): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fileContent = JSON.parse(fs.readFileSync(path).toString('utf8'))
    const validateFunction = ajv.compile(cycloneDxSchema)

    const isValid = validateFunction(fileContent)

    if (!isValid) {
      const errors = validateFunction.errors || []

      errors.forEach((message) => {
        process.stderr.write(`Error while validating file: ${message}\n`)
      })

      return false
    }

    return true
  } catch (error) {
    process.stderr.write(`Error while reading file: ${error.message}\n`)

    return false
  }
}
