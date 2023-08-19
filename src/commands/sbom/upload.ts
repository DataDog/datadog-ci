import fs from 'fs'
import os from 'os'
import process from 'process'

import Ajv from 'ajv'
import {AxiosPromise, AxiosResponse} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {SpanTags} from '../../helpers/interfaces'
import {getSpanTags} from '../../helpers/tags'

import {getApiHelper} from './api'
import {Bom} from './protobuf/bom-1.4'
import {SBOMEntity, SBOMPayload, SBOMSourceType} from './protobuf/sbom_intake'
import {SbomPayloadData} from './types'
import {getValidator, validateSbomFile} from './validation'

const generatePayload = (payloadData: SbomPayloadData, service: string, tags: SpanTags): SBOMPayload => {
  const spanTagsAsStringArray = Object.keys(tags).map((key) => `${key}:${tags[key as keyof SpanTags]}`)

  return SBOMPayload.create({
    host: os.hostname(),
    source: 'CI',
    entities: [
      SBOMEntity.create({
        id: service,
        type: SBOMSourceType.CI_PIPELINE,
        inUse: true,
        generatedAt: new Date(),
        ddTags: spanTagsAsStringArray,
        cyclonedx: Bom.fromJSON(payloadData.content),
      }),
    ],
  })
}

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
  private service = Option.String('--service')
  private env = Option.String('--env')
  private tags = Option.Array('--tags')
  private debug = Option.Boolean('--debug')

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

    this.config.env = this.env || this.config.env

    if (!this.config.env) {
      this.context.stderr.write('Missing env\n')

      return 1
    }

    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    if (!this.config.apiKey) {
      this.context.stderr.write('API key not defined\n')

      return 1
    }

    const api: (sbomPayload: SBOMPayload) => AxiosPromise<AxiosResponse> = getApiHelper(this.config.apiKey)

    const spanTags = await getSpanTags(this.config, this.tags)

    const validator: Ajv = getValidator()
    for (const basePath of this.basePaths) {
      if (this.debug) {
        this.context.stdout.write(`Processing file ${basePath}`)
      }

      if (validateSbomFile(basePath, validator)) {
        // Get the payload to upload
        const payloadData: SbomPayloadData = {
          filePath: basePath,
          content: JSON.parse(fs.readFileSync(basePath).toString('utf8')),
        }

        // If debug mode is activated, we write the payload in a file
        if (this.debug) {
          const debugFilePath = `${basePath}.payload.pbytes`
          this.context.stdout.write(`Writing payload for debugging in: ${debugFilePath}\n`)
          const payloadBytes = SBOMPayload.toJSON(generatePayload(payloadData, service, spanTags))
          fs.writeFileSync(debugFilePath, JSON.stringify(payloadBytes))
        }

        // Upload content
        try {
          const response = await api(generatePayload(payloadData, service, spanTags))
          if (this.debug) {
            this.context.stdout.write(`Upload done, status: ${response.status}\n`)
          }
          this.context.stdout.write(`File ${basePath} successfully uploaded\n`)
        } catch (error) {
          process.stderr.write(`Error while writing the payload: ${error.message}\n`)
          if (error.response) {
            process.stderr.write(`API status: ${error.response.status}\n`)
          }
        }
      } else {
        this.context.stdout.write(`File ${chalk.red.bold(basePath)} is not a valid SBOM file.\n`)
      }
    }

    this.context.stdout.write('Upload finished\n')

    return 0
  }
}
