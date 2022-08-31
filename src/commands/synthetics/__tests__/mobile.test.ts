import {getApiTest, getMobileTest} from './fixtures'

import {ExecutionRule, TestPayload} from '../interfaces'
import {getApplicationToUpload, overriddenMobileConfig} from '../mobile'

const getTestPayload = (override?: Partial<TestPayload>) => {
  return {
    public_id: 'aaa-aaa-aaa',
    executionRule: ExecutionRule.BLOCKING,
    ...override,
  }
}

describe('getApplicationToUpload', () => {
  test('not a mobile test', () => {
    expect(getApplicationToUpload(getApiTest(), getTestPayload())).toBeUndefined()
    expect(
      getApplicationToUpload(getApiTest(), getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'}))
    ).toBeUndefined()
  })

  test('no override', () => {
    expect(getApplicationToUpload(getApiTest(), getTestPayload())).toBeUndefined()
  })

  test('override Android path', () => {
    expect(
      getApplicationToUpload(
        getMobileTest(),
        getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'})
      )
    ).toBe('androidAppPath')
  })

  test('override iOS with path', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'

    expect(
      getApplicationToUpload(mobileTest, getTestPayload({mobileIOSApplicationVersionFilePath: 'iOSAppPath'}))
    ).toBe('iOSAppPath')
  })

  test('override Android with version', () => {
    expect(
      getApplicationToUpload(getMobileTest(), getTestPayload({mobileAndroidApplicationVersion: 'androidVersion'}))
    ).toBeUndefined()
  })

  test('override iOS with version', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'

    expect(
      getApplicationToUpload(mobileTest, getTestPayload({mobileIOSApplicationVersion: 'iOSVersion'}))
    ).toBeUndefined()
  })
})

describe('overriddenMobileConfig', () => {
  test('Android path', () => {
    const overriddenConfig = getTestPayload({mobileAndroidApplicationVersionFilePath: 'androidAppPath'})
    overriddenMobileConfig(getMobileTest(), overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileAndroidApplicationVersionFilePath).toBeUndefined()
  })

  test('iOS path', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'
    const overriddenConfig = getTestPayload({mobileIOSApplicationVersionFilePath: 'iOSAppPath'})

    overriddenMobileConfig(mobileTest, overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileIOSApplicationVersionFilePath).toBeUndefined()
  })

  test('Android version', () => {
    const overriddenConfig = getTestPayload({mobileAndroidApplicationVersion: 'androidVersion'})

    overriddenMobileConfig(getMobileTest(), overriddenConfig)

    expect(overriddenConfig.mobileAndroidApplicationVersion).toBeUndefined()
    expect(overriddenConfig.applicationVersionId).toBe('androidVersion')
  })

  test('iOS version', () => {
    const mobileTest = getMobileTest()
    mobileTest.mobileApplication!.platform = 'ios'
    const overriddenConfig = getTestPayload({mobileIOSApplicationVersion: 'iOSVersion'})

    overriddenMobileConfig(mobileTest, overriddenConfig)

    expect(overriddenConfig.mobileIOSApplicationVersion).toBeUndefined()
    expect(overriddenConfig.applicationVersionId).toBe('iOSVersion')
  })

  test('Android path takes precedence over version', () => {
    const overriddenConfig = getTestPayload({
      mobileAndroidApplicationVersion: 'androidVersion',
      mobileAndroidApplicationVersionFilePath: 'androidAppPath',
    })
    overriddenMobileConfig(getMobileTest(), overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

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
    overriddenMobileConfig(mobileTest, overriddenConfig, {applicationId: 'applicationId', fileName: 'fileName'})

    expect(overriddenConfig).toEqual(expect.objectContaining({applicationId: 'applicationId', fileName: 'fileName'}))
    expect(overriddenConfig.mobileIOSApplicationVersionFilePath).toBeUndefined()
    expect(overriddenConfig.mobileIOSApplicationVersion).toBeUndefined()
  })
})
