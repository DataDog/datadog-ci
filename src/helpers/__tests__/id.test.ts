import id from '../id'

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomFillSync: (data: number[]) => {
    for (let i = 0; i < data.length; i += 8) {
      data[i] = 0xff
      data[i + 1] = 0x00
      data[i + 2] = 0xff
      data[i + 3] = 0x00
      data[i + 4] = 0xff
      data[i + 5] = 0x00
      data[i + 6] = 0xff
      data[i + 7] = 0x00
    }
  },
}))

describe('id', () => {
  it('should return a random 63bit integer', () => {
    expect(id()).toEqual('9151594822560186112')
  })
})
