import { BaseContext, CommandClass } from 'clipanion';

import { ConfigOverride } from '../commands/synthetics/interfaces';

export interface GlobalConfig {
  apiKey?: string;
  appKey?: string;
  datadogHost: string;
  synthetics?: {
    files?: string;
    global?: ConfigOverride;
    timeout?: number;
  };
}

export type ContextWithConfig = BaseContext & {
  config: GlobalConfig;
  defaultConfig: GlobalConfig;
};

export type CommandImport = CommandClass<ContextWithConfig> & { defaultConfig?: Partial<GlobalConfig> };
