import {ExecutionRule, Test, TestPayload} from '../interfaces'
import * as mobile from '../mobile'

import {getApiHelper, getApiTest, getMobileTest} from './fixtures'

const getTestPayload = (override?: Partial<TestPayload>) => ({
  executionRule: ExecutionRule.BLOCKING,
  public_id: 'aaa-aaa-aaa',
  ...override,
})

describe('getApplicationToUpload', () => {
  test('not a mobile test', () => {
    expect(mobile.getApplicationToUpload(getApiTest(), getTestPayload())).toBeUndefined()
    expect(
      mobile.getApplicationToUpload(
        getApiTest(),
        getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'})
      )
    ).toBeUndefined()
  })

  test('no override', () => {
    expect(mobile.getApplicationToUpload(getApiTest(), getTestPayload())).toBeUndefined()
  })

  test('override Android path', () => {
    expect(
      mobile.getApplicationToUpload(
        getMobileTest(),
        getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'})
      )
    ).toBe('androidAppPath')
  })

  test('override iOS with path', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'

    expect(
      mobile.getApplicationToUpload(mobileTest, getTestPayload({mobileIOSApplicationVersionFilePath: 'iOSAppPath'}))
    ).toBe('iOSAppPath')
  })

  test('override Android with version', () => {
    expect(
      mobile.getApplicationToUpload(
        getMobileTest(),
        getTestPayload({mobileAndroidApplicationVersion: 'androidVersion'})
      )
    ).toBeUndefined()
  })

  test('override iOS with version', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'

    expect(
      mobile.getApplicationToUpload(mobileTest, getTestPayload({mobileIOSApplicationVersion: 'iOSVersion'}))
    ).toBeUndefined()
  })
})

describe('overriddenMobileConfig', () => {
  test('Android path', () => {
    const overriddenConfig = getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'})
    mobile.overriddenMobileConfig(getMobileTest(), overriddenConfig, {
      applicationId: 'applicationId',
      fileName: 'fileName',
    })

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileAndroidApplicationVersionFilePath).toBeUndefined()
  })

  test('iOS path', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'
    const overriddenConfig = getTestPayload({mobileIOSApplicationVersionFilePath: 'iOSAppPath'})

    mobile.overriddenMobileConfig(mobileTest, overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileIOSApplicationVersionFilePath).toBeUndefined()
  })

  test('Android version', () => {
    const overriddenConfig = getTestPayload({mobileAndroidApplicationVersion: 'androidVersion'})

    mobile.overriddenMobileConfig(getMobileTest(), overriddenConfig)

    expect(overriddenConfig.mobileAndroidApplicationVersion).toBeUndefined()
    expect(overriddenConfig.applicationVersionId).toBe('androidVersion')
  })

  test('iOS version', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'
    const overriddenConfig = getTestPayload({mobileIOSApplicationVersion: 'iOSVersion'})

    mobile.overriddenMobileConfig(mobileTest, overriddenConfig)

    expect(overriddenConfig.mobileIOSApplicationVersion).toBeUndefined()
    expect(overriddenConfig.applicationVersionId).toBe('iOSVersion')
  })

  test('Android path takes precedence over version', () => {
    const overriddenConfig = getTestPayload({
      mobileAndroidApplicationVersion: 'androidVersion',
      mobileAndroidApplicationVersionFilePath: 'androidAppPath',
    })
    mobile.overriddenMobileConfig(getMobileTest(), overriddenConfig, {
      applicationId: 'applicationId',
      fileName: 'fileName',
    })

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileAndroidApplicationVersionFilePath).toBeUndefined()
    expect(overriddenConfig.mobileAndroidApplicationVersion).toBeUndefined()
  })

  test('iOS path takes precedence over version', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'

    const overriddenConfig = getTestPayload({
      mobileAndroidApplicationVersion: 'iOSVersion',
      mobileAndroidApplicationVersionFilePath: 'iOSAppPath',
    })
    mobile.overriddenMobileConfig(mobileTest, overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileIOSApplicationVersionFilePath).toBeUndefined()
    expect(overriddenConfig.mobileIOSApplicationVersion).toBeUndefined()
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
      'new-application-path.api': [
        {
          applicationId: 'mobileAppUuid',
          fileName: 'fileName',
        },
      ],
      'another-application-path.api': [
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
        mobileAndroidApplicationVersionFilePath: 'androidAppPath',
        public_id: tests[1].public_id,
      }),
    ]

    await mobile.uploadApplicationsAndOverrideConfig(api, tests, overriddenTestsToTrigger)

    expect(overriddenTestsToTrigger).toEqual([
      getTestPayload({public_id: tests[0].public_id}),
      getTestPayload({
        applicationId: 'mobileAppUuid',
        fileName: 'fileName',
        public_id: tests[1].public_id,
      }),
    ])
  })
})
