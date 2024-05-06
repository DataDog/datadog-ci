import {BaseContext} from 'clipanion/lib/advanced'

import {AppUploadDetails} from '../../../interfaces'
import {AppUploadReporter} from '../../../reporters/mobile/app-upload'

describe('AppUploadReporter', () => {
  let reporter: AppUploadReporter

  beforeEach(() => {
    const writeMock = jest.fn()
    const mockContext: unknown = {
      stdout: {write: writeMock},
    }
    reporter = new AppUploadReporter(mockContext as BaseContext)
  })

  afterEach(() => {
    // Clean up any mocks
    jest.restoreAllMocks()
  })

  describe('start', () => {
    test('should write the correct output', () => {
      const appsToUpload: AppUploadDetails[] = [
        {
          versionName: '1.0.0',
          appId: '123',
          appPath: '/path/to/app',
        },
        {
          versionName: '2.0.0',
          appId: '456',
          appPath: '/path/to/another/app',
        },
      ]

      reporter.start(appsToUpload)

      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('2 mobile application(s) to upload:')
      )
      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Version 1.0.0 - Application ID 123 - Local Path /path/to/app')
      )
      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Version 2.0.0 - Application ID 456 - Local Path /path/to/another/app')
      )
    })
  })

  describe('reportSuccess', () => {
    test('should write the correct output', () => {
      reporter.reportSuccess()

      // Assert that the correct output is written to stdout
      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(expect.stringContaining('Successfully uploaded in'))
    })
  })

  describe('reportFailure', () => {
    test('should write the correct output', () => {
      const failedApp: AppUploadDetails = {
        versionName: '1.0.0',
        appId: '123',
        appPath: '/path/to/app',
      }

      reporter.reportFailure(failedApp)

      // Assert that the correct output is written to stdout
      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload application:')
      )
      expect(reporter['context'].stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Version 1.0.0 - Application ID 123 - Local Path /path/to/app')
      )
    })
  })
})
