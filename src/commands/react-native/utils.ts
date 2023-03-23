import {existsSync} from 'fs'

export const getReactNativeVersion = (packageJsonPath: string): undefined | string => {
  if (!existsSync(packageJsonPath)) {
    return undefined
  }

  try {
    return require(packageJsonPath).version as string
  } catch (e) {
    return undefined
  }
}
