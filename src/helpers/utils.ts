import fs from 'fs'
import {promisify} from 'util'

import deepExtend from 'deep-extend'

export function pick<T extends object, K extends keyof T>(base: T, keys: K[]) {
  const definedKeys = keys.filter((key) => !!base[key])
  const pickedObject: Partial<T> = {}

  for (const key of definedKeys) {
    pickedObject[key] = base[key]
  }

  return pickedObject
}

export const parseConfigFile = async <T>(config: T, configPath?: string) => {
  try {
    const resolvedConfigPath = configPath ?? 'datadog-ci.json'
    const configFile = await promisify(fs.readFile)(resolvedConfigPath, 'utf-8')
    const parsedConfig = JSON.parse(configFile)

    return deepExtend(parsedConfig, config) as T
  } catch (e) {
    if (e.code === 'ENOENT' && configPath) {
      throw new Error('Config file not found')
    }

    if (e instanceof SyntaxError) {
      throw new Error('Config file is not correct JSON')
    }
  }

  return config
}
