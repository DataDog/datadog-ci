import * as mobile from '../mobile'

import {getApiHelper, getMobileTest, getTestPayload} from './fixtures'

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    expect(await mobile.getMD5HashFromFileBuffer(Buffer.from('Compute md5'))).toBe('odk1EOlpz16oPIgnco2nfg==')
  })
})

describe('uploadApplication', () => {
  const uploadApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const api = getApiHelper()

  beforeEach(() => {
    uploadApplicationSpy.mockReset()
    uploadApplicationSpy.mockImplementation(async () => 'fileName')
  })

  test('upload new application file', async () => {
    const uploadedApplicationByPath = {}
    await mobile.uploadApplication(api, 'new-application-path.api', 'mobileAppUuid', uploadedApplicationByPath)

    expect(uploadedApplicationByPath).toEqual({
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })
    expect(uploadApplicationSpy).toHaveBeenCalledTimes(1)
  })

  test('upload same application file with different application id', async () => {
    const uploadedApplicationByPath = {
      'new-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplication(api, 'new-application-path.api', 'mobileAppUuid', uploadedApplicationByPath)

    expect(uploadedApplicationByPath).toEqual({
      'new-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })

    expect(uploadApplicationSpy).toHaveBeenCalledTimes(1)
  })

  test('upload different application file with same application id', async () => {
    const uploadedApplicationByPath = {
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplication(api, 'another-application-path.api', 'mobileAppUuid', uploadedApplicationByPath)

    expect(uploadedApplicationByPath).toEqual({
      'another-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })

    expect(uploadApplicationSpy).toHaveBeenCalledTimes(1)
  })

  test('upload different application file with different application id', async () => {
    const uploadedApplicationByPath = {
      'another-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplication(api, 'new-application-path.api', 'mobileAppUuid', uploadedApplicationByPath)

    expect(uploadedApplicationByPath).toEqual({
      'another-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
      ],
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })

    expect(uploadApplicationSpy).toHaveBeenCalledTimes(1)
  })
})

describe('shouldUploadApplication', () => {
  test('New application', () => {
    expect(mobile.shouldUploadApplication('application-path.api', 'mobileAppUuid', {})).toBe(true)
  })

  test('Application already uploaded', () => {
    const uploadedApplicationByPath = {
      'application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    expect(mobile.shouldUploadApplication('application-path.api', 'mobileAppUuid', uploadedApplicationByPath)).toBe(
      false
    )
  })

  test('Application already uploaded but with different applicationId', () => {
    const uploadedApplicationByPath = {
      'application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    expect(mobile.shouldUploadApplication('application-path.api', 'newMobileAppUuid', uploadedApplicationByPath)).toBe(
      true
    )
  })
})

describe('overrideMobileConfig', () => {
  test('mobileApplicationVersionFilePath', () => {
    const test = getMobileTest()
    const overriddenConfig = getTestPayload({public_id: test.public_id})
    mobile.overrideMobileConfig({mobileApplicationVersionFilePath: 'androidAppPath'}, overriddenConfig, test, {
      applicationId: test.options.mobileApplication!.applicationId,
      fileName: 'fileName',
    })

    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'fileName',
      referenceType: 'temporary',
    })
  })

  test('mobileApplicationVersion', () => {
    const test = getMobileTest()
    const overriddenConfig = getTestPayload({public_id: test.public_id})
    mobile.overrideMobileConfig({mobileApplicationVersion: 'newAndroidVersionId'}, overriddenConfig, test)

    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'newAndroidVersionId',
      referenceType: 'version',
    })
  })

  test('Path takes precedence over version', () => {
    const test = getMobileTest()
    const overriddenConfig = getTestPayload({public_id: test.public_id})
    mobile.overrideMobileConfig(
      {
        mobileApplicationVersion: 'androidVersionId',
        mobileApplicationVersionFilePath: 'androidAppPath',
      },
      overriddenConfig,
      getMobileTest(),
      {
        applicationId: test.options.mobileApplication!.applicationId,
        fileName: 'fileName',
      }
    )

    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'fileName',
      referenceType: 'temporary',
    })
  })
})

describe('uploadApplicationAndOverrideConfig', () => {
  const uploadApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const api = getApiHelper()

  beforeEach(() => {
    uploadApplicationSpy.mockReset()
    uploadApplicationSpy.mockImplementation(async () => 'fileName')
  })

  test('Upload and override for mobile tests', async () => {
    const uploadedApplicationByPath: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]} = {}
    const mobileTest = getMobileTest()
    const mobileTestConfig = getTestPayload({public_id: mobileTest.public_id})
    await mobile.uploadApplicationAndOverrideConfig(
      api,
      mobileTest,
      {mobileApplicationVersionFilePath: 'androidAppPath'},
      mobileTestConfig,
      uploadedApplicationByPath
    )

    expect(mobileTestConfig.mobileApplication).toEqual({
      applicationId: 'mobileAppUuid',
      referenceId: 'fileName',
      referenceType: 'temporary',
    })

    await mobile.uploadApplicationAndOverrideConfig(
      api,
      mobileTest,
      {mobileApplicationVersion: 'androidAppVersion'},
      mobileTestConfig,
      uploadedApplicationByPath
    )

    expect(mobileTestConfig.mobileApplication).toEqual({
      applicationId: 'mobileAppUuid',
      referenceId: 'androidAppVersion',
      referenceType: 'version',
    })
  })
})
