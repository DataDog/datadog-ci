import {promises as fs} from 'fs'
import * as path from 'path'

import {Test, TestPayload} from '../interfaces'
import * as mobile from '../mobile'

import {getApiHelper, getApiTest, getMobileTest, getTestPayload} from './fixtures'

// tslint:disable-next-line:no-var-requires
const tmp = require('tmp-promise')

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    const dir = (await tmp.dir({mode: 0o755, unsafeCleanup: true})).path
    await fs.writeFile(path.join(dir, 'file.txt'), 'Compute md5')
    const fileBuffer = await fs.readFile(path.join(dir, 'file.txt'))
    expect(await mobile.getMD5HashFromFileBuffer(fileBuffer)).toBe('odk1EOlpz16oPIgnco2nfg==')
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
        applicationId: 'mobileAppUuid',
        fileName: 'fileName',
        public_id: tests[1].public_id,
      }),
    ])
  })
})
