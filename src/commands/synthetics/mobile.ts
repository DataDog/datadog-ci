import * as crypto from 'crypto'
import fs from 'fs'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper} from './api'
import {CiError} from './errors'
import {
  MobileApplicationUploadPart,
  MobileApplicationUploadPartResponse,
  MobileApplicationVersion,
  MultipartPresignedUrlsResponse,
  Test,
  TestPayload,
  UploadApplicationCommandConfig,
  UserConfigOverride,
} from './interfaces'

const UPLOAD_FILE_MAX_PART_SIZE = 10 * 1024 * 1024

export const getSizeAndPartsFromFile = async (
  filePath: string
): Promise<{appSize: number; parts: MobileApplicationUploadPart[]}> => {
  const readStreamOptions = {
    // this oddly-named parameter will cause chunks to be no more than the given size
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

export const uploadMobileApplications = async (
  api: APIHelper,
  applicationPathToUpload: string,
  mobileApplicationId: string
): Promise<string> => {
  const {appSize, parts} = await getSizeAndPartsFromFile(applicationPathToUpload)

  let multipartPresignedUrlsResponse: MultipartPresignedUrlsResponse
  try {
    multipartPresignedUrlsResponse = await api.getMobileApplicationPresignedURLs(mobileApplicationId, appSize, parts)
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
  try {
    await api.completeMultipartMobileApplicationUpload(mobileApplicationId, uploadId, key, uploadPartResponses)
  } catch (e) {
    throw new EndpointError(
      `Failed to complete upload mobile application: ${formatBackendErrors(e)}\n`,
      e.response?.status
    )
  }

  return multipartPresignedUrlsResponse.file_name
}

export const uploadApplication = async (
  api: APIHelper,
  applicationPathToUpload: string,
  testApplicationId: string,
  uploadedApplicationByPath: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]}
) => {
  const fileName = await uploadMobileApplications(api, applicationPathToUpload, testApplicationId)
  if (!(applicationPathToUpload in uploadedApplicationByPath)) {
    uploadedApplicationByPath[applicationPathToUpload] = []
  }

  uploadedApplicationByPath[applicationPathToUpload].push({
    applicationId: testApplicationId,
    fileName,
  })
}

export const overrideMobileConfig = (
  userConfigOverride: UserConfigOverride,
  overriddenTest: TestPayload,
  test: Test,
  localApplicationOverride?: {applicationId: string; fileName: string}
) => {
  if (localApplicationOverride) {
    overriddenTest.mobileApplication = {
      applicationId: localApplicationOverride.applicationId,
      referenceId: localApplicationOverride.fileName,
      referenceType: 'temporary',
    }
  } else if (userConfigOverride.mobileApplicationVersion) {
    overriddenTest.mobileApplication = {
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: userConfigOverride.mobileApplicationVersion,
      referenceType: 'version',
    }
  }
}

export const shouldUploadApplication = (
  applicationPathToUpload: string,
  testApplicationId: string,
  uploadedApplicationByPath: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]}
): boolean =>
  !(applicationPathToUpload in uploadedApplicationByPath) ||
  !uploadedApplicationByPath[applicationPathToUpload].some(({applicationId}) => applicationId === testApplicationId)

export const uploadApplicationAndOverrideConfig = async (
  api: APIHelper,
  test: Test,
  userConfigOverride: UserConfigOverride,
  overriddenTestsToTrigger: TestPayload,
  uploadedApplicationByPath: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]}
): Promise<void> => {
  const testApplicationId = test.options.mobileApplication!.applicationId
  if (
    userConfigOverride.mobileApplicationVersionFilePath &&
    shouldUploadApplication(
      userConfigOverride.mobileApplicationVersionFilePath,
      testApplicationId,
      uploadedApplicationByPath
    )
  ) {
    await uploadApplication(
      api,
      userConfigOverride.mobileApplicationVersionFilePath,
      testApplicationId,
      uploadedApplicationByPath
    )
  }

  const localApplicationOverride = userConfigOverride.mobileApplicationVersionFilePath
    ? uploadedApplicationByPath[userConfigOverride.mobileApplicationVersionFilePath].find(
        ({applicationId}) => applicationId === testApplicationId
      )
    : undefined

  overrideMobileConfig(userConfigOverride, overriddenTestsToTrigger, test, localApplicationOverride)
}

export const createNewMobileVersion = async (
  api: APIHelper,
  version: MobileApplicationVersion
): Promise<MobileApplicationVersion> => {
  let newVersion: MobileApplicationVersion
  try {
    newVersion = await api.createMobileVersion(version)
  } catch (e) {
    throw new EndpointError(`Failed create new Mobile Version: ${formatBackendErrors(e)}\n`, e.response?.status)
  }

  return newVersion
}

export const uploadMobileApplicationVersion = async (
  config: UploadApplicationCommandConfig
): Promise<MobileApplicationVersion> => {
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

  const fileName = await uploadMobileApplications(
    api,
    config.mobileApplicationVersionFilePath,
    config.mobileApplicationId
  )

  const version = await createNewMobileVersion(api, {
    file_name: fileName,
    application_id: config.mobileApplicationId,
    original_file_name: config.mobileApplicationVersionFilePath,
    version_name: config.versionName,
    is_latest: config.latest,
  })

  return version
}
