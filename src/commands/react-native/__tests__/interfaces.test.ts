import fs from 'fs'

import {RNSourcemap} from '../interfaces'

describe('interfaces', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  describe('removeSourcesContentFromSourceMap', () => {
    test('should remove the sources content part of sourcemaps', (done) => {
      const sourcemap = new RNSourcemap(
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
