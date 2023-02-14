import {Payload} from './interfaces'

export const renderUpload = (payload: Payload): string => `Uploading SARIF report in ${payload.reportPath}\n`
