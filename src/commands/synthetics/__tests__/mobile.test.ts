import fs from 'fs'
import {promises as fsPromise} from 'fs'
import path from 'path'

import {default as axios} from 'axios'

import * as mobile from '../mobile'

import {getApiHelper, getMobileTest, getTestPayload, MOBILE_PRESIGNED_URL_PAYLOAD} from './fixtures'

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    const tmpdir = fs.mkdtempSync('getMD5HashFromFileBuffer')
    try {
      // write test content to a file in the temporary directory
      const filename = path.join(tmpdir, 'compute_md5_test')
      fs.writeFileSync(filename, 'Compute md5')

      expect(await mobile.getMD5HashFromFile(filename)).toBe('odk1EOlpz16oPIgnco2nfg==')
    } finally {
      // always clean up created tmpdir
      fs.rmSync(tmpdir, {recursive: true, force: true})
    }
  })
})

describe('uploadApplication', () => {
  const uploadApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const api = getApiHelper()

  beforeEach(() => {
    uploadApplicationSpy.mockImplementation(async () => 'fileName')
  })

  afterAll(() => {
    jest.restoreAllMocks()
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

describe('uploadMobileApplications', () => {
  afterAll(() => {
    jest.restoreAllMocks()
  })

  test('throws if the size of the application is invalid', async () => {
    const api = getApiHelper()
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: MOBILE_PRESIGNED_URL_PAYLOAD})) as any)
    jest.spyOn(mobile, 'getMD5HashFromFile').mockImplementation(async () => '0cc175b9c0f1b6a831c399e269772661')
    jest.spyOn(fsPromise, 'readFile').mockImplementation(async () => {
      return Buffer.from('7 bytes') // one bytes file
    })

    await expect(mobile.uploadMobileApplications(api, 'new-application-path.api', 'mobileAppUuid')).rejects.toThrow(
      `Invalid Mobile Application size. Expect a size between 1 KiB and 1 GiB, got 7 byte(s).`
    )
  })
})

describe('shouldUploadApplication', () => {
  afterAll(() => {
    jest.restoreAllMocks()
  })

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
  afterAll(() => {
    jest.restoreAllMocks()
  })

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
  const api = getApiHelper()

  test('Upload and override for mobile tests', async () => {
    jest.spyOn(mobile, 'uploadMobileApplications').mockImplementation(async () => 'fileName')
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
