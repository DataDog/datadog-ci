import fs from 'fs'

import type {ErrorObject} from 'ajv'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import sarifJsonSchema from './json-schema/sarif-schema-2.1.0.json'

const maxSarifFileSize = 100 * 1024 * 1024 // 100MB in bytes

/**
 * Validate the SARIF file and check if the file is too large or not valid
 * against the SARIF schema.
 *
 * @param sarifReportPath - the path of the SARIF file
 */
export const validateSarif = (sarifReportPath: string): string | undefined => {
  try {
    const stats = fs.statSync(sarifReportPath) // Synchronously get file stats
    const fileSize = stats.size

    if (fileSize > maxSarifFileSize) {
      return `file size too large (size: ${fileSize / 1024 / 1024} MB, max size: ${maxSarifFileSize / 1024 / 1024} MB)`
    }
  } catch (err) {
    return err.message
  }

  const ajv = new Ajv({allErrors: true})
  addFormats(ajv)
  const sarifJsonSchemaValidate = ajv.compile(sarifJsonSchema)
  try {
    const sarifReportContent = JSON.parse(String(fs.readFileSync(sarifReportPath)))
    const valid = sarifJsonSchemaValidate(sarifReportContent)
    if (!valid) {
      const errors = sarifJsonSchemaValidate.errors || []
      const errorMessages = errors.map((error: ErrorObject) => {
        return `${error.instancePath}: ${error.message}`
      })

      return errorMessages.join('\n')
    }
  } catch (error) {
    return error.message
  }

  return undefined
}

/**
 * Functions that looks for errors specific to how Datadog processes SARIF file. This way, we
 * show the error directly to the user instead of uploading a file we cannot process in our backend.
 *
 * The function returns a list of errors to show. The return value is empty if there is no error.
 *
 * @param filePath - the path of the SARIF file.
 */
export const checkForError = (filePath: string): string[] => {
  const report: any = JSON.parse(String(fs.readFileSync(filePath)))
  const res: string[] = []

  if ('runs' in report) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    for (const run of report['runs']) {
      const rules: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ('tool' in run && 'driver' in run['tool'] && 'rules' in run['tool']['driver']) {
        for (const rule of run['tool']['driver']['rules']) {
          if ('id' in rule) {
            rules.push(rule['id'])
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ('tool' in run && 'extensions' in run['tool']) {
        for (const extension of run['tool']['extensions']) {
          if ('rules' in extension) {
            for (const rule of extension['rules']) {
              if ('id' in rule) {
                rules.push(rule['id'])
              }
            }
          }
        }
      }

      if ('results' in run) {
        for (const result of run['results']) {
          if (!('ruleId' in result)) {
            res.push('a result should have a ruleId')
            continue
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
          const ruleId: string = result['ruleId']
          if (rules.indexOf(ruleId) === -1) {
            res.push(`result references rule ${ruleId} but rule not found in the tool section`)
          }
        }
      }
    }
  }

  return res
}
