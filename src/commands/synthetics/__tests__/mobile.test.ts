import {Test, TestPayload} from '../interfaces'
import * as mobile from '../mobile'

import {getApiHelper, getApiTest, getMobileTest, getTestPayload} from './fixtures'

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    expect(await mobile.getMD5HashFromFileBuffer(Buffer.from('Compute md5'))).toBe('odk1EOlpz16oPIgnco2nfg==')
  })
})

describe('uploadApplicationIfNeeded', () => {
  const uploadApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const api = getApiHelper()

  beforeEach(() => {
    uploadApplicationSpy.mockReset()
    uploadApplicationSpy.mockImplementation(async () => 'fileName')
  })

  test('upload new application file', async () => {
    const uploadedApplicationByApplication = {}
    await mobile.uploadApplicationIfNeeded(
      api,
      'new-application-path.api',
      getMobileTest(),
      uploadedApplicationByApplication
    )

    expect(uploadedApplicationByApplication).toEqual({
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })
    expect(uploadApplicationSpy).toHaveBeenCalledTimes(1)
  })

  test('upload same application file with same application id', async () => {
    const uploadedApplicationByApplication = {
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }

    await mobile.uploadApplicationIfNeeded(
      api,
      'new-application-path.api',
      getMobileTest(),
      uploadedApplicationByApplication
    )

    expect(uploadedApplicationByApplication).toEqual({
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    })

    expect(uploadApplicationSpy).not.toHaveBeenCalled()
  })

  test('upload same application file with different application id', async () => {
    const uploadedApplicationByApplication = {
      'new-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplicationIfNeeded(
      api,
      'new-application-path.api',
      getMobileTest(),
      uploadedApplicationByApplication
    )

    expect(uploadedApplicationByApplication).toEqual({
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
    const uploadedApplicationByApplication = {
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplicationIfNeeded(
      api,
      'another-application-path.api',
      getMobileTest(),
      uploadedApplicationByApplication
    )

    expect(uploadedApplicationByApplication).toEqual({
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
    const uploadedApplicationByApplication = {
      'another-application-path.api': [
        {
          applicationId: 'anotherMobileAppUuid',
          fileName: 'fileName',
        },
      ],
    }
    await mobile.uploadApplicationIfNeeded(
      api,
      'new-application-path.api',
      getMobileTest(),
      uploadedApplicationByApplication
    )

    expect(uploadedApplicationByApplication).toEqual({
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

describe('overrideMobileConfig', () => {
  test('mobileApplicationVersionFilePath', () => {
    const overriddenConfig = getTestPayload({mobileApplicationVersionFilePath: 'androidAppPath'})
    const test = getMobileTest()
    mobile.overrideMobileConfig(overriddenConfig, test, {
      applicationId: test.options.mobileApplication!.applicationId,
      fileName: 'fileName',
    })

    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'fileName',
      referenceType: 'TEMPORARY',
    })
    expect(overriddenConfig.mobileApplicationVersionFilePath).toBeUndefined()
  })

  test('mobileApplicationVersion', () => {
    const overriddenConfig = getTestPayload({mobileApplicationVersion: 'newAndroidVersionId'})
    const test = getMobileTest()
    mobile.overrideMobileConfig(overriddenConfig, test)

    expect(overriddenConfig.mobileApplicationVersion).toBeUndefined()
    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'newAndroidVersionId',
      referenceType: 'VERSION',
    })
  })

  test('Path takes precedence over version', () => {
    const overriddenConfig = getTestPayload({
      mobileApplicationVersion: 'androidVersionId',
      mobileApplicationVersionFilePath: 'androidAppPath',
    })

    const test = getMobileTest()
    mobile.overrideMobileConfig(overriddenConfig, getMobileTest(), {
      applicationId: test.options.mobileApplication!.applicationId,
      fileName: 'fileName',
    })

    expect(overriddenConfig.mobileApplication).toEqual({
      applicationId: test.options.mobileApplication!.applicationId,
      referenceId: 'fileName',
      referenceType: 'TEMPORARY',
    })
    expect(overriddenConfig.mobileApplicationVersionFilePath).toBeUndefined()
    expect(overriddenConfig.mobileApplicationVersion).toBeUndefined()
  })
})

describe('uploadApplicationsAndOverrideConfig', () => {
  const uploadApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const api = getApiHelper()

  beforeEach(() => {
    uploadApplicationSpy.mockReset()
    uploadApplicationSpy.mockImplementation(async () => 'fileName')
  })

  test('Upload and override for mobile tests and skip for others', async () => {
    const tests: Test[] = [getApiTest(), getMobileTest('mob-ile-abc')]

    const overriddenTestsToTrigger: TestPayload[] = [
      getTestPayload({public_id: tests[0].public_id}),
      getTestPayload({
        mobileApplicationVersionFilePath: 'androidAppPath',
        public_id: tests[1].public_id,
      }),
    ]

    await mobile.uploadApplicationsAndOverrideConfig(api, tests, overriddenTestsToTrigger)

    expect(overriddenTestsToTrigger).toEqual([
      getTestPayload({public_id: tests[0].public_id}),
      getTestPayload({
        mobileApplication: {
          applicationId: tests[1].options.mobileApplication!.applicationId,
          referenceId: 'fileName',
          referenceType: 'TEMPORARY',
        },
        public_id: tests[1].public_id,
      }),
    ])
  })
})
