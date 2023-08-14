import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import cycloneDxSchema from './json-schema/cyclonedx/bom-1.4.schema.json'
import jsfSchema from './json-schema/jsf/jsf-0.82.schema.json'
import spdxSchema from './json-schema/spdx/spdx.schema.json'
import fs from 'fs'
import process from 'process'
import {getSpanTags} from '../../helpers/tags'
import {SbomPayloadData} from './types'
import {SBOMEntity, SBOMPayload, SBOMSourceType} from './protobuf/sbom_intake'
import os from 'os'
import {SpanTags} from '../../helpers/interfaces'

/**
 * Get the validate function. Read all the schemas and return
 * the function used to validate all SBOM documents.
 */
const getValidator = (): Ajv => {
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
const validateSbomFile = (path: string, ajv: Ajv): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fileContent = JSON.parse(String(fs.readFileSync(path)))
    const validateFunction = ajv.compile(cycloneDxSchema)

    const isValid = validateFunction(fileContent)

    if (!isValid) {
      const errors = validateFunction.errors || []

      errors.forEach((em) => {
        process.stderr.write(`Error while reading file: ${em}\n`)
      })

      return false
    }

    return true
  } catch (error) {
    process.stderr.write(`Error while reading file: ${error.message}\n`)

    return false
  }
}

const generatePayload = (payloadData: SbomPayloadData, tags: SpanTags): SBOMPayload => {
  const spanTagsAsStringArray = Object.keys(tags).map((key) => `${key}:${tags[key as keyof SpanTags]}`)

  return SBOMPayload.create({
    host: os.hostname(),
    source: 'CI',
    entities: [
      SBOMEntity.create({
        id: payloadData.filePath,
        type: SBOMSourceType.UNSPECIFIED,
        generatedAt: new Date(),
        ddTags: spanTagsAsStringArray,
        cyclonedx: undefined,
      }),
    ],
  })
}

const getApiHelper = () => {}

export class UploadSbomCommand extends Command {
  public static paths = [['sbom', 'upload']]

  public static usage = Command.Usage({
    description: 'Upload SBOM files to Datadog.',
    details: `
      This command uploads SBOM files to Datadog for dependency tracking.
    `,
    examples: [['Upload the SBOM file sbom.json', 'datadog-ci sbom upload --service my-service file.sbom']],
  })

  private basePaths = Option.Rest({required: 1})
  private dryRun = Option.Boolean('--dry-run', false)
  private service = Option.String('--service')
  private tags = Option.Array('--tags')
  private noVerify = Option.Boolean('--no-verify', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }

  /**
   * Execute the command, which means parse the SBOM file, ensure they are
   * compliant with their schema and upload them to datadog.
   */
  public async execute() {
    const service: string | undefined = this.service || process.env.DD_SERVICE

    if (!service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    const api = getApiHelper()

    const spanTags = await getSpanTags(this.config, this.tags)

    const validator: Ajv = getValidator()
    this.basePaths.forEach((basePath: string): void => {
      if (validateSbomFile(basePath, validator)) {
        // Get the payload to upload
        const payloadData: SbomPayloadData = {
          filePath: basePath,
          content: JSON.parse(String(fs.readFileSync(basePath))),
        }
        const payloadBytes = SBOMPayload.encode(generatePayload(payloadData, spanTags)).finish()

        // Upload content

        fs.writeFileSync(`${basePath}.payload.pbytes`, payloadBytes)
      } else {
        this.context.stdout.write(`File ${chalk.red.bold(basePath)} is not a valid SBOM file.\n`)
      }
    })
    this.context.stdout.write('finished')

    return 1
  }
}
