import {pick} from '../utils'
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
})
