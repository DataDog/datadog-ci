import fs from 'fs'
import os from 'os'
import path from 'path'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import chalk from 'chalk'
import {Command} from 'clipanion'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath} from '../../helpers/utils'

import {apiConstructor} from './api'
import {APIHelper, SBomFileObject} from './interfaces'
import cycloneDxJsonSchema from './json-schema/cyclonedx/bom-1.4.schema.json'
import jsfJsonSchema from './json-schema/jsf-0.82.schema.json'
import spdxJsonSchema from './json-schema/spdx/spdx.schema.json'
import {Bom} from './pb/bom-1.4'
import {SBOMEntity, SBOMPayload, SBOMSourceType} from './pb/sbom_intake'
import {
  renderCommandInfo,
  renderSuccessfulCommand,
  renderDryRunUpload,
  renderRetriedUpload,
  renderFailedUpload,
  renderInvalidFile,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

const errorCodesStopUpload = [400, 403]

export class UploadSBomFileCommand extends Command {
  public static usage = Command.Usage({})

  private ajv: Ajv
  private basePaths?: string[]
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }
  private dryRun = false
  private env?: string
  private maxConcurrency = 20
  private service?: string
  private tags?: string[]

  constructor() {
    super()

    const ajv = new Ajv({strict: false, validateFormats: false})
    ajv.addMetaSchema(spdxJsonSchema)
    ajv.addMetaSchema(jsfJsonSchema)
    addFormats(ajv)
    this.ajv = ajv
  }

  public async execute() {
    if (!this.service) {
      this.service = process.env.DD_SERVICE
    }

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    if (!this.config.env) {
      this.config.env = this.env
    }

    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
    this.context.stdout.write(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

    const initialDate = new Date()
    const spanTags = await this.getSpanTags()
    const spanTagsAsStringArray = Object.keys(spanTags).map((key) => `${key}:${spanTags[key as keyof SpanTags]}`)

    const sbomPayloads = this.getMatchingSBomFiles().map((sbomFile) => {
      var sbom = SBOMPayload.create({
        host: os.hostname(),
        source: 'CI',
        entities: [
          SBOMEntity.create({
            id: sbomFile.filePath,
            type: SBOMSourceType.UNSPECIFIED,
            generatedAt: initialDate,
            tags: spanTagsAsStringArray,
            cyclonedx: Bom.fromJSON(sbomFile.content),
          }),
        ],
      })
      fs.writeFileSync(sbomFile.filePath + ".payload.json", JSON.stringify(SBOMPayload.toJSON(sbom), null, "  "))
      const sbomPB = SBOMPayload.encode(sbom).finish()
      fs.writeFileSync(sbomFile.filePath + ".payload.pbytes", sbomPB)
      return sbom
    })

    const api = this.getApiHelper()
    const upload = (payload: SBOMPayload) => this.uploadSBomPayload(api, payload)

    await asyncPool(this.maxConcurrency, sbomPayloads, upload)

    const initialTime = initialDate.getTime()
    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(
      renderSuccessfulCommand(sbomPayloads.length, totalTimeSeconds, spanTags, this.service, this.config.env)
    )
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...cliTags,
      ...envVarTags,
      ...(this.config.env ? {env: this.config.env} : {}),
      ...(this.service ? {service_name: this.service} : {}),
    }
  }

  private getMatchingSBomFiles(): SBomFileObject[] {
    const sbomFiles = (this.basePaths || []).reduce((acc: string[], basePath: string) => {
      const isFile = !!path.extname(basePath)
      if (isFile) {
        return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
      }

      return acc.concat(glob.sync(buildPath(basePath, '*.json')))
    }, [])

    return sbomFiles
      .map((sbomFile) => {
        const sbomObj = this.getSBomObjectFrom(sbomFile)
        if (sbomObj.err) {
          this.context.stdout.write(renderInvalidFile(sbomFile, sbomObj.err))
        }

        return sbomObj
      })
      .filter((sbomObject) => sbomObject.content !== undefined)
  }

  private getSBomObjectFrom(sbomPath: string): SBomFileObject {
    try {
      const cycloneDxJsonSchemaValidate = this.ajv.compile(cycloneDxJsonSchema)
      const cycloneDxSBomContent = JSON.parse(String(fs.readFileSync(sbomPath)))
      const valid = cycloneDxJsonSchemaValidate(cycloneDxSBomContent)
      if (!valid) {
        const errors = cycloneDxJsonSchemaValidate.errors || []

        return {filePath: sbomPath, content: undefined, err: this.ajv.errorsText(errors, {})}
      }

      return {filePath: sbomPath, content: cycloneDxSBomContent, err: undefined}
    } catch (error) {
      return {filePath: sbomPath, content: undefined, err: error.message}
    }
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey)
  }

  private async uploadSBomPayload(api: APIHelper, sbomPayload: SBOMPayload) {
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunUpload())

      return
    }

    try {
      await retryRequest(
        () => api.uploadSBomPayload(sbomPayload, this.context.stdout.write.bind(this.context.stdout)),
        {
          onRetry: (e, attempt) => {
            this.context.stderr.write(renderRetriedUpload(sbomPayload, e.message, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(sbomPayload, error))
      if (error.response) {
        // If it's an axios error
        if (!errorCodesStopUpload.includes(error.response.status)) {
          // And a status code that should not stop the whole upload, just return
          return
        }
      }
      throw error
    }
  }
}

UploadSBomFileCommand.addPath('sbom', 'upload')
UploadSBomFileCommand.addOption('service', Command.String('--service'))
UploadSBomFileCommand.addOption('env', Command.String('--env'))
UploadSBomFileCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadSBomFileCommand.addOption('tags', Command.Array('--tags'))
UploadSBomFileCommand.addOption('basePaths', Command.Rest({required: 1}))
UploadSBomFileCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
