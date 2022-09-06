import * as crypto from 'crypto'
import * as fs from 'fs'

import {APIHelper} from './api'
import {Test, TestPayload} from './interfaces'
import {getTestByPublicId} from './utils'

export const getMD5HashFromFileBuffer = async (fileBuffer: Buffer): Promise<string> => {
  const hash = crypto.createHash('md5').update(fileBuffer).digest('base64')

  return hash
}

export const uploadMobileApplications = async (
  api: APIHelper,
  applicationPathToUpload: string,
  mobileApplicationId: string
): Promise<string> => {
  const fileBuffer = await fs.promises.readFile(applicationPathToUpload)
  const md5 = await getMD5HashFromFileBuffer(fileBuffer)
  const {presigned_url_params: presignedUrl, file_name: fileName} = await api.getMobileApplicationPresignedURL(
    mobileApplicationId,
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
      ({applicationId}) => applicationId === test.options.mobileApplication!.applicationId
    )

  if (!isAlreadyUploaded) {
    const fileName = await uploadMobileApplications(
      api,
      applicationPathToUpload,
      test.options.mobileApplication!.applicationId
    )

    if (!(applicationPathToUpload in uploadedApplicationByApplication)) {
      uploadedApplicationByApplication[applicationPathToUpload] = []
    }

    uploadedApplicationByApplication[applicationPathToUpload].push({
      applicationId: test.options.mobileApplication!.applicationId,
      fileName,
    })
  }
}

export const overrideMobileConfig = (
  overriddenTest: TestPayload,
  test: Test,
  localApplicationOverride?: {applicationId: string; fileName: string}
) => {
  if (localApplicationOverride) {
    overriddenTest.mobileApplication = {
      applicationId: localApplicationOverride.applicationId,
      referenceId: localApplicationOverride.fileName,
      referenceType: 'TEMPORARY',
    }
  }

  delete overriddenTest.mobileApplicationVersionFilePath

  console.log({overriddenTest, test})
  if (!localApplicationOverride && overriddenTest.mobileApplicationVersion) {
    overriddenTest.mobileApplication = {
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: overriddenTest.mobileApplicationVersion,
      referenceType: 'VERSION',
    }
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
      overrideMobileConfig(overriddenTest, test)
      continue
    }

    await uploadApplicationIfNeeded(
      api,
      overriddenTest.mobileApplicationVersionFilePath,
      test,
      uploadedApplicationByApplication
    )

    overrideMobileConfig(
      overriddenTest,
      test,
      uploadedApplicationByApplication[overriddenTest.mobileApplicationVersionFilePath].find(
        ({applicationId}) => applicationId === test.options.mobileApplication!.applicationId
      )
    )
  }
}
