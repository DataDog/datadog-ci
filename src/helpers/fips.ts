import {createHash, setFips} from 'crypto'

export class UnsupportedFipsError extends Error {
  constructor() {
    super('FIPS mode is not supported')
  }
}

export const enableFips = (ignoreError = false): boolean => {
  try {
    setFips(true)
    createHash('md5').update('md5 is unsupported with fips mode enabled').digest('hex')
  } catch (error) {
    if ('code' in error && error.code === 'ERR_OSSL_EVP_UNSUPPORTED') {
      return true
    }
  }

  if (ignoreError) {
    return false
  } else {
    throw new UnsupportedFipsError()
  }
}
