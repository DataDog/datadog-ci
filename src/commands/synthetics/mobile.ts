import * as crypto from 'crypto'
import fs from 'fs'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper} from './api'
import {CiError, CriticalError} from './errors'
import {
  MobileAppUploadResult,
  MobileApplicationUploadPart,
  MobileApplicationUploadPartResponse,
  MultipartPresignedUrlsResponse,
  TestPayload,
  UploadApplicationCommandConfig,
  MobileApplicationNewVersionParams,
  TriggerConfig,
  TestNotFound,
  TestSkipped,
  TestWithOverride,
  AppUploadDetails,
} from './interfaces'
import { AppUploadReporter } from './reporters/appUpload'

const UPLOAD_FILE_MAX_PART_SIZE = 10 * 1024 * 1024 // MiB

export const getSizeAndPartsFromFile = async (
  filePath: string
): Promise<{appSize: number; parts: MobileApplicationUploadPart[]}> => {
  const readStreamOptions = {
    // Limit the chunk size for the stream
    // https://nodejs.org/api/stream.html#buffering
    highWaterMark: UPLOAD_FILE_MAX_PART_SIZE,
  }
  const fileStream = fs.createReadStream(filePath, readStreamOptions)
  const parts: MobileApplicationUploadPart[] = []
  for await (const chunk of fileStream) {
    if (!(chunk instanceof Buffer)) {
      // this should never happen, but for-await-of creates an any that we don't want
      throw new Error('Unexpected chunk type from file stream')
    }

    parts.push({
      md5: crypto.createHash('md5').update(chunk).digest('base64'),
      partNumber: parts.length + 1,
      blob: chunk,
    })
  }

  return {
    appSize: fileStream.bytesRead,
    parts,
  }
}

export const uploadMobileApplication = async (
  api: APIHelper,
  applicationPathToUpload: string,
  applicationId: string,
  newVersionParams?: MobileApplicationNewVersionParams
): Promise<{appUploadResponse: MobileAppUploadResult, fileName: string}> => {
  const {appSize, parts} = await getSizeAndPartsFromFile(applicationPathToUpload)

  let multipartPresignedUrlsResponse: MultipartPresignedUrlsResponse
  try {
    multipartPresignedUrlsResponse = await api.getMobileApplicationPresignedURLs(applicationId, appSize, parts)
  } catch (e) {
    throw new EndpointError(`Failed to get presigned URL: ${formatBackendErrors(e)}\n`, e.response?.status)
  }

  let uploadPartResponses: MobileApplicationUploadPartResponse[]
  try {
    uploadPartResponses = await api.uploadMobileApplicationPart(
      parts,
      multipartPresignedUrlsResponse.multipart_presigned_urls_params
    )
  } catch (e) {
    throw new EndpointError(`Failed to upload mobile application: ${formatBackendErrors(e)}\n`, e.response?.status)
  }

  const {upload_id: uploadId, key} = multipartPresignedUrlsResponse.multipart_presigned_urls_params
  let jobId: string
  try {
    jobId = await api.completeMultipartMobileApplicationUpload(applicationId, uploadId, key, uploadPartResponses, newVersionParams)
  } catch (e) {
    throw new EndpointError(
      `Failed to complete upload mobile application: ${formatBackendErrors(e)}\n`,
      e.response?.status
    )
  }

  let appUploadResponse: MobileAppUploadResult
  try {
    appUploadResponse = await api.pollMobileApplicationUploadResponse(jobId)
  } catch (e) {
    throw new EndpointError(
      `Failed to validate mobile application: ${formatBackendErrors(e)}\n`,
      e.response?.status
    )
  }

  if (appUploadResponse.status === 'complete' && !appUploadResponse.is_valid) {
    throw new CiError('INVALID_MOBILE_APP', `Mobile application failed validation for reason: ${appUploadResponse.invalid_app_result?.invalid_message}`)
  }

  if (appUploadResponse.status === 'user_error') {
    throw new CiError('INVALID_MOBILE_APP_UPLOAD_PARAMETERS', `Mobile application failed validation for reason: ${appUploadResponse.user_error_result?.user_error_message}`)
  }

  if (appUploadResponse.status === 'error') {
    throw new CriticalError('UNKNOWN_MOBILE_APP_UPLOAD_FAILURE', `Unknown mobile application upload error.`)
  }

  return {appUploadResponse, fileName: multipartPresignedUrlsResponse.file_name}

}

export class AppUploadCache {
  private cache: {[applicationFilePath: string]: {[applicationId: string]: string | undefined}} = {}

  public setAppCacheKeys(triggerConfigs: TriggerConfig[], testsAndConfigsOverride: (TestNotFound | TestSkipped | TestWithOverride)[]): void {
    for (const [index, item] of testsAndConfigsOverride.entries()){
      if (
        'test' in item &&
        item.test.type === 'mobile' &&
        !('errorMessage' in item)
      ) {
        const appId = item.test.options.mobileApplication!.applicationId
        const userConfigOverride = triggerConfigs[index].config
        const appPath = userConfigOverride.mobileApplicationVersionFilePath
        if (appPath && (!this.cache[appPath] || !this.cache[appPath][appId])) {
          this.cache[appPath] = {
            ...this.cache[appPath] || {},
            [appId]: undefined,
          }
        }
      }
    }
  }

  public getAppsToUpload(): AppUploadDetails[] {
    const appsToUpload: AppUploadDetails[] = []
    for (const appPath of Object.keys(this.cache)){
      for (const appId of Object.keys(this.cache[appPath])){
        appsToUpload.push({appId, appPath})
      }
    }

    return appsToUpload
  }

  public getFileName(appPath: string, appId: string): string | undefined {
    return this.cache[appPath][appId]
  }

  public setFileName(appPath: string, appId: string, fileName: string): void {
    this.cache[appPath][appId] = fileName
  }
}

export const overrideMobileConfig = (
  overriddenTest: TestPayload,
  appId: string,
  tempFileName?: string,
  mobileApplicationVersion?: string
) => {
  if (tempFileName) {
    overriddenTest.mobileApplication = {
      applicationId: appId,
      referenceId: tempFileName,
      referenceType: 'temporary',
    }
  } else if (mobileApplicationVersion) {
    overriddenTest.mobileApplication = {
      applicationId: appId,
      referenceId: mobileApplicationVersion,
      referenceType: 'version',
    }
  }
}

export const uploadMobileApplicationVersion = async (
  config: UploadApplicationCommandConfig
): Promise<MobileAppUploadResult> => {
  const api = getApiHelper(config)

  if (!config.mobileApplicationVersionFilePath) {
    throw new CiError('MISSING_MOBILE_APPLICATION_PATH', 'Mobile application path is required.')
  }

  if (!config.mobileApplicationId) {
    throw new CiError('MISSING_MOBILE_APPLICATION_ID', 'Mobile application id is required.')
  }

  if (!config.versionName) {
    throw new CiError('MISSING_MOBILE_VERSION_NAME', 'Version name is required')
  }
  config.latest = config.latest ?? false

  const newVersionParams = {
    originalFileName: config.mobileApplicationVersionFilePath,
    versionName: config.versionName,
    isLatest: config.latest,
  } as MobileApplicationNewVersionParams

  const {appUploadResponse} = await uploadMobileApplication(
    api,
    config.mobileApplicationVersionFilePath,
    config.mobileApplicationId,
    newVersionParams
  )

  return appUploadResponse
}

export const uploadMobileApplicationsAndOverrideConfigs = async (
  api: APIHelper,
  triggerConfigs: TriggerConfig[],
  testsAndConfigsOverride: (TestNotFound | TestSkipped | TestWithOverride)[],
  appUploadReporter: AppUploadReporter
): Promise<void> => {
  const appUploadCache = new AppUploadCache()
  appUploadCache.setAppCacheKeys(triggerConfigs, testsAndConfigsOverride)
  const appsToUpload = appUploadCache.getAppsToUpload()

  appUploadReporter.start(appsToUpload)
  for (const [index, item] of appsToUpload.entries()) {
    appUploadReporter.renderProgress(appsToUpload.length - index)
    try {
      const fileName = (await uploadMobileApplication(api, item.appPath, item.appId)).fileName
      appUploadCache.setFileName(item.appPath, item.appId, fileName)
    } catch (error) {
      appUploadReporter.reportFailure(error, item)
      throw error
    }

  }
  appUploadReporter.reportSuccess()

  for (const [index, item] of testsAndConfigsOverride.entries()) {
    if (
      'test' in item
    ) {
      const appId = item.test.options.mobileApplication!.applicationId
      const userConfigOverride = triggerConfigs[index].config
      const appPath = userConfigOverride.mobileApplicationVersionFilePath
      let fileName: string | undefined
      if (appPath) {
        fileName = appUploadCache.getFileName(appPath, appId)
      }
      overrideMobileConfig(item.overriddenConfig, appId, fileName, userConfigOverride.mobileApplicationVersion)
    }
  }
}
