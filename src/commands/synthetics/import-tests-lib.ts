import {getApiHelper} from './api'
import {ImportTestsCommandConfig} from './interfaces'

export const importTests = async (config: ImportTestsCommandConfig) => {
  const api = getApiHelper(config)
  console.log('Importing tests...')
  for (const publicId of config.publicIds) {
    const test = await api.getTest(publicId)
    console.log(test)
  }
}
