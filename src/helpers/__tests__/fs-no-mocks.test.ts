import upath from 'upath'

import {globAsync, globSync} from '../fs'

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

describe('fs', () => {
  describe('globSync', () => {
    it('absolute paths', () => {
      expect(globSync(`${CWD}/src/helpers/__tests__/*-no-mocks.test.ts`)).toStrictEqual([
        `${CWD}/src/helpers/__tests__/fs-no-mocks.test.ts`,
      ])
    })

    it('relative paths', () => {
      expect(globSync('src/helpers/__tests__/*-no-mocks.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })

    it('relative paths with dotRelative option', () => {
      expect(globSync('src/helpers/__tests__/*-no-mocks.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })
  })

  describe('globAsync', () => {
    it('absolute paths', async () => {
      expect(await globAsync(`${CWD}/src/helpers/__tests__/*-no-mocks.test.ts`)).toStrictEqual([
        `${CWD}/src/helpers/__tests__/fs-no-mocks.test.ts`,
      ])
    })

    it('works with dotRelative option', async () => {
      expect(await globAsync('src/helpers/__tests__/*-no-mocks.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })

    it('relative paths with dotRelative option', async () => {
      expect(await globAsync('src/helpers/__tests__/*-no-mocks.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })
  })
})
