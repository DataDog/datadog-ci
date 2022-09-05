import * as mobile from '../mobile'

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    expect(await mobile.getMD5HashFromFileBuffer(Buffer.from('Compute md5'))).toBe('odk1EOlpz16oPIgnco2nfg==')
  })
})
