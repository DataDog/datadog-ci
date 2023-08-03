import process from 'process'

import {MOCK_CWD} from '../../../helpers/__tests__/fixtures'
import {renderAdditionalFiles, renderProjectFiles} from '../../../helpers/renderer'

import {renderAuthenticationInstructions} from '../renderer'

process.cwd = jest.fn().mockReturnValue(MOCK_CWD)

describe('renderer', () => {
  test('renderAuthenticationInstructions', () => {
    expect(renderAuthenticationInstructions()).toMatchSnapshot()
  })

  describe('renderProjectFiles', () => {
    it('returns correct text when no project files were found', () => {
      expect(renderProjectFiles(new Set())).toMatchSnapshot()
    })

    it('returns correct text when multiple project files are found', () => {
      const mockFiles = new Set(['package.json', 'yarn.lock', 'tsconfig.json'])
      expect(renderProjectFiles(mockFiles)).toMatchSnapshot()
    })
  })

  describe('renderAdditionalFiles', () => {
    it('returns correct text when no additional files were added', () => {
      expect(renderAdditionalFiles(new Set())).toMatchSnapshot()
    })

    it('returns correct text when an additional file is added', () => {
      const mockFiles = new Set(['README.md'])
      expect(renderAdditionalFiles(mockFiles)).toMatchSnapshot()
    })
  })
})
