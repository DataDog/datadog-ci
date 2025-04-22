import upath from 'upath'

import {globAsync, globSync} from '../glob'

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

describe('fs', () => {
  describe('globSync', () => {
    it('absolute paths', () => {
      expect(globSync(`${CWD}/src/helpers/*/glob.test.ts`)).toStrictEqual([`${CWD}/src/helpers/__tests__/glob.test.ts`])
    })

    it('relative paths', () => {
      expect(globSync('src/helpers/*/glob.test.ts')).toStrictEqual(['src/helpers/__tests__/glob.test.ts'])
    })

    it('relative paths with dotRelative option', () => {
      expect(globSync('src/helpers/*/glob.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/glob.test.ts',
      ])
    })
  })

  describe('globAsync', () => {
    it('absolute paths', async () => {
      expect(await globAsync(`${CWD}/src/helpers/*/glob.test.ts`)).toStrictEqual([
        `${CWD}/src/helpers/__tests__/glob.test.ts`,
      ])
    })

    it('works with dotRelative option', async () => {
      expect(await globAsync('src/helpers/*/glob.test.ts')).toStrictEqual(['src/helpers/__tests__/glob.test.ts'])
    })

    it('relative paths with dotRelative option', async () => {
      expect(await globAsync('src/helpers/*/glob.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/glob.test.ts',
      ])
    })
  })
})
