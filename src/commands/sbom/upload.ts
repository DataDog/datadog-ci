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

// import {apiConstructor} from './api'
import {APIHelper, Payload, SBomFileObject} from './interfaces'
import cycloneDxJsonSchema from './json-schema/cyclonedx/bom-1.4.schema.json'
import spdxJsonSchema from './json-schema/spdx/spdx.schema.json'
import jsfJsonSchema from './json-schema/jsf-0.82.schema.json'
import {
  renderCommandInfo,
  renderSuccessfulCommand,
  renderDryRunUpload,
  renderRetriedUpload,
  renderFailedUpload,
  renderInvalidFile,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

import { SBOMEntity, SBOMPayload, SBOMSourceType } from './pb/sbom_intake'
import { Bom } from './pb/bom-1.4'
import { Message } from 'protobufjs'

export class UploadSBomFileCommand extends Command {
    public static usage = Command.Usage({})

    // private const errorCodesStopUpload = [400, 403]
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

        const ajv = new Ajv({ strict: false, validateFormats: false })
        ajv.addMetaSchema(spdxJsonSchema)
        ajv.addMetaSchema(jsfJsonSchema)
        addFormats(ajv)
        this.ajv = ajv;
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

        // const api = this.getApiHelper()
        this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
        this.context.stdout.write(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

        const initialDate = new Date()
        const spanTags = await this.getSpanTags()
        const spanTagsAsStringArray = Object.keys(spanTags)
            .map(key => `${key}:${spanTags[key as keyof SpanTags]}`)

        const sbomEntities = this.getMatchingSBomFiles().map(sbomFile => {
            const sbomEntity = SBOMEntity.create({
                id: sbomFile.filePath,
                type: SBOMSourceType.UNSPECIFIED,
                generatedAt: initialDate,
                tags: spanTagsAsStringArray,
                cyclonedx: Bom.fromJSON(sbomFile.content)
            })
            return sbomEntity
        })

        const sbomPayload = SBOMPayload.create({ 
            host: os.hostname(),
            source: "CI",
            entities: sbomEntities
        })

        // const upload = (p: Payload) => this.uploadSarifReport(api, p)

        const initialTime = initialDate.getTime()

        // await asyncPool(this.maxConcurrency, payloads, upload)

        const totalTimeSeconds = (Date.now() - initialTime) / 1000
        // this.context.stdout.write(
        //     renderSuccessfulCommand(payloads.length, totalTimeSeconds, spanTags, this.service, this.config.env)
        // )

        var buffer = SBOMPayload.encode(sbomPayload).finish();
        fs.writeFileSync("/var/tmp/sbompayload.pbytes", buffer);

        var sbomPayloadJson = SBOMPayload.toJSON(sbomPayload)
        fs.writeFileSync("/var/tmp/sbompayload.json", JSON.stringify(sbomPayloadJson, null, "  "))
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

        return sbomFiles.map(sbomFile => {
            const sbomObj = this.getSBomObjectFrom(sbomFile);
            if (sbomObj.err) {
                this.context.stdout.write(renderInvalidFile(sbomFile, sbomObj.err))
            }

            return sbomObj
        }).filter(sbomObject => sbomObject.content !== undefined);
    }

    private getSBomObjectFrom(sbomPath: string) : SBomFileObject {
        try {
            const cycloneDxJsonSchemaValidate = this.ajv.compile(cycloneDxJsonSchema)
            const cycloneDxSBomContent = JSON.parse(String(fs.readFileSync(sbomPath)))
            const valid = cycloneDxJsonSchemaValidate(cycloneDxSBomContent)
            if (!valid) {
                const errors = cycloneDxJsonSchemaValidate.errors || []
                return { filePath: sbomPath, content: undefined, err: this.ajv.errorsText(errors, {}) }
            }

            return { filePath: sbomPath, content: cycloneDxSBomContent, err: undefined }
        } catch (error) {
            return { filePath: sbomPath, content: undefined, err: (error as any).message }
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