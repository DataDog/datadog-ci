/* eslint-disable import-x/order */
import {PluginCheckCommand} from './check'
import {PluginInstallCommand} from './install'
import {PluginListCommand} from './list'

// prettier-ignore
export const commands = [
  PluginCheckCommand,
  PluginInstallCommand,
  PluginListCommand,
]
