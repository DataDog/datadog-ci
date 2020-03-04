import { CommandClass } from 'clipanion';

import { ConfigOverride } from '../commands/synthetics/_interfaces';

export interface GlobalConfig {
  apiKey?: string;
  appKey?: string;
  datadogHost: string;
  proxy?: {
    address: string;
    ignoreSSLErrors?: boolean;
    password?: string;
    protocol: string;
    user?: string;
  };
  synthetics?: {
    files?: string;
    global?: ConfigOverride;
    timeout?: number;
  };
}

export interface CommandImport {
  [key: string]: CommandClass & { defaultConfig?: Partial<GlobalConfig> };
}
