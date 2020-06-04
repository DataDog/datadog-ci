jest.mock('fs')

import {pick, parseConfigFile} from '../utils'
import * as fs from 'fs'
jest.useFakeTimers()

describe('utils', () => {
  test('Test pick', () => {
    const initialHash = {a: 1, b: 2}

    let resultHash = pick(initialHash, ['a'])
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1)
    expect(resultHash.a).toBe(1)

    resultHash = pick(initialHash, ['c'] as any)
    expect(Object.keys(resultHash).length).toBe(0)
  })

  describe('parseConfigFile', () => {
    afterEach(() => {
      ;(fs.readFile as any).mockRestore()
    })
    test('should read a config file', async () => {
      ;(fs.readFile as any).mockImplementation((_path: string, _opts: any, callback: any) =>
        callback(undefined, '{"newconfigkey":"newconfigvalue"}')
      )

      const config: any = await parseConfigFile({})
      expect(config.newconfigkey).toBe('newconfigvalue')
    })

    test('should throw an error if path is provided and config file is not found', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      const config = parseConfigFile({}, '/veryuniqueandabsentfile')

      await expect(config).rejects.toEqual(Error('Config file not found'))
    })

    test('should throw an error if JSON parsing fails', async () => {
      ;(fs.readFile as any).mockImplementation((p: string, o: any, cb: any) => cb(undefined, 'thisisnoJSON'))

      await expect(parseConfigFile({})).rejects.toEqual(Error('Config file is not correct JSON'))
    })
  })
})
