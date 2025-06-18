import {existsSync} from 'fs'

import {RNPlatform} from './interfaces'

export const getReactNativeVersion = (packageJsonPath: string): undefined | string => {
  if (!existsSync(packageJsonPath)) {
    return undefined
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
    return require(packageJsonPath).version as string
  } catch (e) {
    return undefined
  }
}

const DEFAULT_ANDROID_BUNDLE_NAME = 'index.android.bundle'
const DEFAULT_IOS_BUNDLE_NAME = 'main.jsbundle'

export const getBundleName = (bundlePath: string | undefined, platform: RNPlatform): string => {
  if (bundlePath) {
    const splitPath = bundlePath.split('/')

    return splitPath[splitPath.length - 1]
  }
  if (platform === 'ios') {
    return DEFAULT_IOS_BUNDLE_NAME
  }

  return DEFAULT_ANDROID_BUNDLE_NAME
}

export const sanitizeReleaseVersion = (version: string) => {
  return version.replace(/^(>=|<=|==|=|<|>|\^|~)/, '').trim()
}
