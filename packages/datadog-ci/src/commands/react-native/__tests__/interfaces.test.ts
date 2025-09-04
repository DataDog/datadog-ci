import fs from 'fs/promises'

import {createMockContext} from '../../../helpers/__tests__/testing-tools'
import {MultipartFileValue} from '../../../helpers/upload'

import {RNSourcemap} from '../interfaces'

describe('interfaces', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  describe('removeSourcesContentFromSourceMap', () => {
    test('should remove the sources content part of sourcemaps', async () => {
      const sourcemap = new RNSourcemap(
        'main.jsbundle',
        './src/commands/react-native/__tests__/fixtures/with-sources-content/main.jsbundle.map'
      )
      sourcemap.removeSourcesContentFromSourceMap()
      const payload = sourcemap.asMultipartPayload(
        '1.0',
        'com.myapp',
        '1.2.3',
        '',
        'android',
        '102030',
        createMockContext()
      )
      const sourcemapFilePath = (payload.content.get('source_map') as MultipartFileValue).path

      const fileContent = await fs.readFile(sourcemapFilePath, 'utf8')

      expect(fileContent).toContain('"sources":["Users/me/datadog-ci/src/commands/sourcemaps/__tests__/git.test.ts"]')
      expect(fileContent).not.toContain('"sourcesContent"')
    })
  })
})
