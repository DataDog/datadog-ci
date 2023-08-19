import fs from 'fs'

import type Ajv from 'ajv'
import type {ErrorObject} from 'ajv'

import sarifJsonSchema from './json-schema/sarif-schema-2.1.0.json'

/**
 * Get the validate function. Read all the schemas and return
 * the function used to validate all SBOM documents.
 */
export const getValidator = async (): Promise<Ajv> => {
  const {default: Ajv} = await import('ajv')
  const {default: addFormats} = await import('ajv-formats')

  const ajv = new Ajv({allErrors: true})
  addFormats(ajv)

  return ajv
}

/**
 * Validate an SBOM file.
 * @param path - the path of the file to validate
 * @param ajv - an instance of Ajv fully initialized and ready to use.
 */
export const validateSarifFile = (path: string, ajv: Ajv): string | undefined => {
  try {
    const validateFunction = ajv.compile(sarifJsonSchema)
    const sarifReportContent = JSON.parse(fs.readFileSync(path).toString('utf-8'))
    const valid = validateFunction(sarifReportContent)
    if (!valid) {
      const errors = validateFunction.errors || []
      const errorMessages = errors.map((error: ErrorObject) => {
        return `${error.instancePath}: ${error.message}`
      })

      return errorMessages.join('\n')
    }
  } catch (error) {
    return error.message as string
  }
}
