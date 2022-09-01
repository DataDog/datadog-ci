import * as crypto from 'crypto'
import * as fs from 'fs'

import {APIHelper} from './api'
import {Test, TestPayload} from './interfaces'
import {getTestByPublicId} from './utils'

export const getMD5HashFromFile = async (fileBuffer: Buffer): Promise<string> => {
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
  overriddenTest: TestPayload,
  localApplicationOverride?: {applicationId: string; fileName: string}
) => {
  if (localApplicationOverride) {
    overriddenTest.applicationId = localApplicationOverride.applicationId
    overriddenTest.fileName = localApplicationOverride.fileName
  }

  delete overriddenTest.mobileApplicationVersionFilePath

  if (!localApplicationOverride && overriddenTest.mobileApplicationVersion) {
    overriddenTest.applicationVersionId = overriddenTest.mobileApplicationVersion
  }

  delete overriddenTest.mobileApplicationVersion
}

export const uploadApplicationsAndOverrideConfig = async (
  api: APIHelper,
  tests: Test[],
  overriddenTestsToTrigger: TestPayload[]
): Promise<void> => {
  const uploadedApplicationByApplication: {
    [applicationFilePath: string]: {applicationId: string; fileName: string}[]
  } = {}

  for (const overriddenTest of overriddenTestsToTrigger) {
    const test = getTestByPublicId(overriddenTest.public_id, tests)
    if (test.type !== 'mobile') {
      continue
    }

    if (!overriddenTest.mobileApplicationVersionFilePath) {
      overriddenMobileConfig(overriddenTest)
      continue
    }

    await uploadApplicationIfNeeded(
      api,
      overriddenTest.mobileApplicationVersionFilePath,
      test,
      uploadedApplicationByApplication
    )

    overriddenMobileConfig(
      overriddenTest,
      uploadedApplicationByApplication[overriddenTest.mobileApplicationVersionFilePath].find(
        ({applicationId}) => applicationId === test.mobileApplication!.id
      )
    )
  }
}
