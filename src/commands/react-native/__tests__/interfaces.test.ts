import {MultipartPayload} from '../../../helpers/upload'
import {RNSourcemap} from '../interfaces'

jest.mock('fs', () => ({
  createReadStream: jest.fn(),
}))

describe('interfaces', () => {
  describe('getBundleName', () => {
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
})

const getMetadataFromPayload = (payload: MultipartPayload): {[k: string]: any} =>
  JSON.parse(payload.content.get('event')!.value.toString())
