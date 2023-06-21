import fs from 'fs'
import path from 'path'

import {EndpointError} from '../api'
import {CiError} from '../errors'
import * as mobile from '../mobile'

import {getApiHelper, getMobileTest, getMobileVersion, getTestPayload, uploadCommandConfig} from './fixtures'

describe('getSizeAndMD5HashFromFile', () => {
  test('correctly get size and md5 of a file', async () => {
    const tmpdir = fs.mkdtempSync('getSizeAndMD5HashFromFile')
    try {
      // write test content to a file in the temporary directory
      const filename = path.join(tmpdir, 'compute_md5_test')
      fs.writeFileSync(filename, '7 bytes')

      expect(await mobile.getSizeAndMD5HashFromFile(filename)).toEqual({appSize: 7, md5: 'QCi9PCxLLuyHmU0aRshoeA=='})
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

describe('uploadMobileApplicationVersion', () => {
  const uploadMobileApplicationSpy = jest.spyOn(mobile, 'uploadMobileApplications')
  const createNewMobileVersionSpy = jest.spyOn(mobile, 'createNewMobileVersion')
  const config = uploadCommandConfig

  beforeEach(() => {
    uploadMobileApplicationSpy.mockReset()
    createNewMobileVersionSpy.mockReset()
  })

  test('upload new application file', async () => {
    uploadMobileApplicationSpy.mockImplementation(async () => 'abc-123')
    createNewMobileVersionSpy.mockImplementation(async () => getMobileVersion({id: 'def-456'}))

    await mobile.uploadMobileApplicationVersion(config)

    expect(uploadMobileApplicationSpy).toHaveBeenCalledTimes(1)
    const callArg = createNewMobileVersionSpy.mock.calls[0][1]
    expect(callArg.file_name).toBe('abc-123')
  })

  test('get pre-signe URL fails', async () => {
    uploadMobileApplicationSpy.mockImplementation(() => {
      throw new EndpointError('mock fail', 1)
    })

    await expect(mobile.uploadMobileApplicationVersion(config)).rejects.toThrow(EndpointError)

    expect(createNewMobileVersionSpy).toHaveBeenCalledTimes(0)
  })

  test('missing mobile application ID', async () => {
    config.mobileApplicationId = ''
    await expect(mobile.uploadMobileApplicationVersion(config)).rejects.toThrow(CiError)

    expect(uploadMobileApplicationSpy).toHaveBeenCalledTimes(0)
    expect(createNewMobileVersionSpy).toHaveBeenCalledTimes(0)
  })

  test('missing mobile application file', async () => {
    delete config.mobileApplicationVersionFilePath
    await expect(mobile.uploadMobileApplicationVersion(config)).rejects.toThrow(CiError)

    expect(uploadMobileApplicationSpy).toHaveBeenCalledTimes(0)
    expect(createNewMobileVersionSpy).toHaveBeenCalledTimes(0)
  })

  test('missing version name', async () => {
    delete config.versionName
    await expect(mobile.uploadMobileApplicationVersion(config)).rejects.toThrow(CiError)

    expect(uploadMobileApplicationSpy).toHaveBeenCalledTimes(0)
    expect(createNewMobileVersionSpy).toHaveBeenCalledTimes(0)
  })
})
