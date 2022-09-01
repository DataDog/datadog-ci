import * as crypto from 'crypto'
import * as fs from 'fs'

import {APIHelper} from './api'
import {Test, TestPayload} from './interfaces'
import {getTestByPublicId} from './utils'

export const getApplicationToUpload = (test: Test, overrideTest: TestPayload): string | undefined => {
  if (test.type !== 'mobile') {
    return
  }

  if (test.mobileApplication!.platform === 'android') {
    return overrideTest.mobileAndroidApplicationVersionFilePath
  }

  if (test.mobileApplication!.platform === 'ios') {
    return overrideTest.mobileIOSApplicationVersionFilePath
  }
}

const getMD5HashFromFile = async (fileBuffer: Buffer): Promise<string> => {
  const hash = crypto.createHash('md5').update(fileBuffer).digest('base64')

  return hash
}

export const uploadMobileApplications = async (
  api: APIHelper,
  applicationPathToUpload: string,
  test: Test
): Promise<string> => {
  const fileBuffer = await fs.promises.readFile(applicationPathToUpload)
  const md5 = await getMD5HashFromFile(fileBuffer)
  const {presigned_url_params: presignedUrl, file_name: fileName} = await api.getMobileApplicationPresignedURL(
    test.mobileApplication!.id,
    md5
  )

  await api.uploadMobileApplication(fileBuffer, presignedUrl)

  return fileName
}

export const uploadApplicationIfNeeded = async (
  api: APIHelper,
  applicationPathToUpload: string,
  test: Test,
  uploadedApplicationByApplication: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]}
) => {
  const isAlreadyUploaded =
    applicationPathToUpload in uploadedApplicationByApplication &&
    uploadedApplicationByApplication[applicationPathToUpload].find(
      ({applicationId}) => applicationId === test.mobileApplication!.id
    )

  if (!isAlreadyUploaded) {
    const fileName = await uploadMobileApplications(api, applicationPathToUpload, test)

    if (!(applicationPathToUpload in uploadedApplicationByApplication)) {
      uploadedApplicationByApplication[applicationPathToUpload] = []
    }

    uploadedApplicationByApplication[applicationPathToUpload].push({
      applicationId: test.mobileApplication!.id,
      fileName,
    })
  }
}

export const overriddenMobileConfig = (
  test: Test,
  overriddenTest: TestPayload,
  localApplicationOverride?: {applicationId: string; fileName: string}
) => {
  if (localApplicationOverride) {
    overriddenTest.applicationId = localApplicationOverride.applicationId
    overriddenTest.fileName = localApplicationOverride.fileName
  }

  delete overriddenTest.mobileAndroidApplicationVersionFilePath
  delete overriddenTest.mobileIOSApplicationVersionFilePath

  if (
    !localApplicationOverride &&
    test.mobileApplication!.platform === 'android' &&
    overriddenTest.mobileAndroidApplicationVersion
  ) {
    overriddenTest.applicationVersionId = overriddenTest.mobileAndroidApplicationVersion
  }

  delete overriddenTest.mobileAndroidApplicationVersion

  if (
    !localApplicationOverride &&
    test.mobileApplication!.platform === 'ios' &&
    overriddenTest.mobileIOSApplicationVersion
  ) {
    overriddenTest.applicationVersionId = overriddenTest.mobileIOSApplicationVersion
  }

  delete overriddenTest.mobileIOSApplicationVersion
}

export const uploadMobileApplicationsAndOverrideMobileConfig = async (
  api: APIHelper,
  tests: Test[],
  overriddenTestsToTrigger: TestPayload[]
) => {
  const uploadedApplicationByApplication: {
    [applicationFilePath: string]: {applicationId: string; fileName: string}[]
  } = {}

  for (const overriddenTest of overriddenTestsToTrigger) {
    const test = getTestByPublicId(overriddenTest.public_id, tests)

    const applicationPathToUpload = getApplicationToUpload(test, overriddenTest)
    if (!applicationPathToUpload) {
      if (test.type === 'mobile') {
        overriddenMobileConfig(test, overriddenTest)
      }

      return
    }

    await uploadApplicationIfNeeded(api, applicationPathToUpload, test, uploadedApplicationByApplication)

    overriddenMobileConfig(
      test,
      overriddenTest,
      uploadedApplicationByApplication[applicationPathToUpload].find(
        ({applicationId}) => applicationId === test.mobileApplication!.id
      )
    )
  }
}
