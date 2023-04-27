import * as crypto from 'crypto'
import fs from 'fs'

import {APIHelper} from './api'
import {CriticalError} from './errors'
import {Test, TestPayload, UserConfigOverride} from './interfaces'

export const MAX_APPLICATION_SIZE = 1 * 1024 * 1024 * 1024 // 1 GiB
export const MIN_APPLICATION_SIZE = 1 * 1024 // 1 KiB

export const getMD5HashFromFile = async (file: string): Promise<string> => {
  const hash = crypto.createHash('md5')
  const input = fs.createReadStream(file)
  for await (const chunk of input) {
    hash.update(chunk)
  }

  return hash.digest('base64')
}

export const uploadMobileApplications = async (
  api: APIHelper,
  applicationPathToUpload: string,
  mobileApplicationId: string
): Promise<string> => {
  const md5 = await getMD5HashFromFile(applicationPathToUpload)
  const {presigned_url_params: presignedUrl, file_name: fileName} = await api.getMobileApplicationPresignedURL(
    mobileApplicationId,
    md5
  )

  const fileBuffer = await fs.promises.readFile(applicationPathToUpload)
  const fileBufferBytesSize = fileBuffer.byteLength
  if (fileBufferBytesSize < MIN_APPLICATION_SIZE || MAX_APPLICATION_SIZE < fileBufferBytesSize) {
    throw new CriticalError(
      'INVALID_MOBILE_APPLICATION_SIZE',
      `Invalid Mobile Application size. Expect a size between 1 KiB and 1 GiB, got ${fileBufferBytesSize} byte(s).`
    )
  }

  await api.uploadMobileApplication(fileBuffer, presignedUrl)

  return fileName
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
