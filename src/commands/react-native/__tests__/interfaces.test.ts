import fs from 'fs'
import {MultipartPayload} from '../../../helpers/upload'
import {RNSourcemap} from '../interfaces'

describe('interfaces', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })
  describe('getBundleName', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => undefined as any)
    })
    test('should return the bundle name when specified', () => {
      const sourcemap = new RNSourcemap('./custom.bundle', './custom.bundle.map', 'index.android.bundle')
      expect(
        getMetadataFromPayload(sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android', '102030'))
          .bundle_name
      ).toBe('index.android.bundle')
    })

    test('should extract the bundle name from the file when not specified', () => {
      const sourcemap = new RNSourcemap('./index.android.bundle', './index.android.bundle.map')
      expect(
        getMetadataFromPayload(sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android', '102030'))
          .bundle_name
      ).toBe('index.android.bundle')
    })

    test('should extract the bundle name from the file when not specified and no slash in path', () => {
      const sourcemap = new RNSourcemap('index.android.bundle', 'index.android.bundle.map')
      expect(
        getMetadataFromPayload(sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android', '102030'))
          .bundle_name
      ).toBe('index.android.bundle')
    })
  })

  describe('removeSourcesContentFromSourceMap', () => {
    test('should remove the sources content part of sourcemaps', (done) => {
      const sourcemap = new RNSourcemap(
        './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle',
        './src/commands/react-native/__tests__/fixtures/with-sources-content/main.jsbundle.map'
      )
      sourcemap.removeSourcesContentFromSourceMap()
      const payload = sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android', '102030')

      const sourcemapFileHandle = payload.content.get('source_map')?.value as fs.ReadStream
      let fileContent = ''
      sourcemapFileHandle.on('close', () => {
        expect(fileContent).toContain('"sources":["Users/me/datadog-ci/src/commands/sourcemaps/__tests__/git.test.ts"]')
        expect(fileContent).not.toContain('"sourcesContent"')
        done()
      })
      sourcemapFileHandle.on('data', (chunk) => {
        fileContent = `${fileContent}${chunk.toString()}`
      })
    })
  })
})

const getMetadataFromPayload = (payload: MultipartPayload): {[k: string]: any} =>
  JSON.parse(payload.content.get('event')!.value.toString())
