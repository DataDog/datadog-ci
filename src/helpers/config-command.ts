
import fs from 'fs';
import { promisify } from 'util';

import { Command } from 'clipanion';
import deepExtend from 'deep-extend';

import { ContextWithConfig } from './interfaces';

export class CommandWithConfig extends Command<ContextWithConfig> {
  protected configPath?: string;
  protected defaultConfigPath = 'datadog-ci.json';

  public async execute (): Promise<number | void> {
    try {
      const configPath = this.configPath || this.defaultConfigPath;
      const configFile = await promisify(fs.readFile)(configPath, 'utf-8');
      const config = JSON.parse(configFile);
      this.context.config = deepExtend(this.context.defaultConfig, config);
    } catch (e) {
      if (e.code === 'ENOENT' && this.configPath) {
        throw new Error('Config file not found');
      }

      if (e instanceof SyntaxError) {
        throw new Error('Config file is not correct JSON');
      }
    }
  }
}

CommandWithConfig.addOption('configPath', Command.String('--config'));
