import type {Writable} from 'stream'

import chalk from 'chalk'
import ora from 'ora'

import { CommandContext } from '../../../helpers/interfaces'

import { AppUploadDetails } from '../interfaces'

import { ICONS } from './constants'

export class AppUploadReporter {
    private context: CommandContext
    private spinner?: ora.Ora
    private startTime: number
    private write: Writable['write']

    constructor({context}: {context: CommandContext}) {
        this.context = context
        this.write = context.stdout.write.bind(context.stdout)
        this.startTime = Date.now()
    }

    public start(appsToUpload: AppUploadDetails[]) {
        this.write(`\n${appsToUpload.length} mobile application(s) to upload:\n`)
        this.write(appsToUpload.map((appToUpload) => this.getAppRepr(appToUpload)).join('\n') + '\n')
    }

    public renderProgress(numberOfApplicationsLeft: number) {
        const text = `Uploading ${numberOfApplicationsLeft} application(s)…`
        this.spinner?.stop()
        this.spinner = ora({
            stream: this.context.stdout,
            text,
        })
        this.spinner.start()
    }

    public reportSuccess() {
        this.endRendering()
        this.write(`${ICONS.SUCCESS} Uploaded applications in ${Math.round((Date.now() - this.startTime)/1000)}s`)
    }

    public reportFailure(error: Error, failedApp: AppUploadDetails) {
        this.endRendering()
        this.write(`${ICONS.FAILED} Failed to upload application:\n${this.getAppRepr(failedApp)}\n`)
        this.write(`${chalk.red(error.message)}\n`)
    }

    public endRendering() {
        this.spinner?.stop()
        delete this.spinner
    }

    private getAppRepr(appUploadDetails: AppUploadDetails) {
        let versionPrepend = ''
        if (appUploadDetails.versionName) {
            versionPrepend = `Version ${chalk.dim.cyan(appUploadDetails.versionName)} - `
        }

        return `    ${versionPrepend}Application ID ${chalk.dim.cyan(appUploadDetails.appId)} - Local Path ${chalk.dim.cyan(appUploadDetails.appPath)}`
    }
}
