import fs from 'fs'

import type {CommandContext} from '@datadog/datadog-ci-base'

import {createMockContext} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {extractDebugId} from '../debugId'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'

const mockFileContent = (content: string) => {
  jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(content)
}

describe('extractDebugId', () => {
  let context: CommandContext

  beforeEach(() => {
    context = createMockContext() as CommandContext
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('snippet formats', () => {
    test.each([
      [`{"ddDebugId":"${DEBUG_ID}"}`],
      [`{"ddDebugId": "${DEBUG_ID}"}`],
      [`{"ddDebugId" : "${DEBUG_ID}"}`],
      [`{"ddDebugId"   :   "${DEBUG_ID}"}`],
      [`{"ddDebugId"\t:\t"${DEBUG_ID}"}`],
      [`{'ddDebugId': '${DEBUG_ID}'}`],
      [`var x=1;({"ddDebugId":"${DEBUG_ID}"});var y=2;`],
      [`var x=1;\n{"ddDebugId": "${DEBUG_ID}"}\nvar y=2;`],
    ])('%s', (content: string) => {
      mockFileContent(content)
      expect(extractDebugId('bundle.js', context)).toBe(DEBUG_ID)
      expect(context.stderr.toString()).toBe('')
    })
  })

  describe('missing or unreadable', () => {
    test('returns undefined and writes to stderr when snippet is absent', () => {
      mockFileContent('var x = 1; console.log("hello");')
      expect(extractDebugId('bundle.js', context)).toBeUndefined()
      expect(context.stderr.toString()).toContain('Debug ID not found')
    })

    test('returns undefined and writes to stderr when file cannot be read', () => {
      jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file or directory')
      })
      expect(extractDebugId('nonexistent.js', context)).toBeUndefined()
      expect(context.stderr.toString()).toContain('Cannot extract Debug ID')
    })
  })
})
