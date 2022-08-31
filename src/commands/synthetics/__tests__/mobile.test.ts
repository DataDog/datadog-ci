import {getApiTest, getMobileTest} from './fixtures'

import {ExecutionRule, TestPayload} from '../interfaces'
import {getApplicationToUpload} from '../mobile'

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

  test('no override', () => {
    expect(getApplicationToUpload(getApiTest(), getTestPayload())).toBeUndefined()
  })

  test('override Android with path', () => {
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
