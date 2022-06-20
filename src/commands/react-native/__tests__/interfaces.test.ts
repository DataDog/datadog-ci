import {RNSourcemap} from '../interfaces'

jest.mock('fs', () => ({
  createReadStream: jest.fn(),
}))

describe('interfaces', () => {
  describe('getBundleName', () => {
    test('should return the bundle name when specified', () => {
      const sourcemap = new RNSourcemap('./custom.bundle', './custom.bundle.map', 'index.android.bundle')
      expect(
        sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android').content.get('bundle_name')?.value
      ).toBe('index.android.bundle')
    })

    test('should extract the bundle name from the file when not specified', () => {
      const sourcemap = new RNSourcemap('./index.android.bundle', './index.android.bundle.map')
      expect(
        sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android').content.get('bundle_name')?.value
      ).toBe('index.android.bundle')
    })

    test('should extract the bundle name from the file when not specified and no slash in path', () => {
      const sourcemap = new RNSourcemap('index.android.bundle', 'index.android.bundle.map')
      expect(
        sourcemap.asMultipartPayload('1.0', 'com.myapp', '1.2.3', '', 'android').content.get('bundle_name')?.value
      ).toBe('index.android.bundle')
    })
  })
})
