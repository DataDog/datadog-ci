import * as crypto from 'crypto'
import fs from 'fs'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper} from './api'
import {CiError} from './errors'
import {
  MobileApplicationVersion,
  PresignedUrlResponse,
  Test,
  TestPayload,
  UploadApplicationCommandConfig,
  UserConfigOverride,
} from './interfaces'

export const getSizeAndMD5HashFromFile = async (filePath: string): Promise<{appSize: number; md5: string}> => {
  const hash = crypto.createHash('md5')
  const fileStream = fs.createReadStream(filePath)
  for await (const chunk of fileStream) {
    hash.update(chunk)
  }

  return {appSize: fileStream.bytesRead, md5: hash.digest('base64')}
}

export const uploadMobileApplications = async (
  api: APIHelper,
  applicationPathToUpload: string,
  mobileApplicationId: string
): Promise<string> => {
  const {appSize, md5} = await getSizeAndMD5HashFromFile(applicationPathToUpload)

  let presignedUrlResponse: PresignedUrlResponse
  try {
    presignedUrlResponse = await api.getMobileApplicationPresignedURL(mobileApplicationId, appSize, md5)
  } catch (e) {
    throw new EndpointError(`Failed to get presigned URL: ${formatBackendErrors(e)}\n`, e.response?.status)
  }

  const fileBuffer = await fs.promises.readFile(applicationPathToUpload)
  try {
    await api.uploadMobileApplication(fileBuffer, presignedUrlResponse.presigned_url_params)
  } catch (e) {
    throw new EndpointError(`Failed to upload mobile application: ${formatBackendErrors(e)}\n`, e.response?.status)
  }

  return presignedUrlResponse.file_name
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
