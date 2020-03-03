import chalk from 'chalk';
import { Command } from 'clipanion';

import { MainCommand } from '../../index';

import { apiConstructor } from './_api';

export abstract class SyntheticsBaseCommand extends MainCommand {
  public static defaultConfig = {
    files: '{,!(node_modules)/**/}*.synthetics.json',
    global: { },
    timeout: 2 * 60 * 1000,
  };
  public static defaultConfigKey = 'synthetics';
  public publicId = '';

  protected getApiHelper () {
    this.config.apiKey = this.apiKey || this.config.apiKey;
    this.config.appKey = this.appKey || this.config.appKey;

    if (!this.config.apiKey || !this.config.appKey) {
      console.log(
        `Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`
      );
      throw new Error('API and/or Application keys are missing');
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      appKey: this.config.appKey!,
      baseUrl: this.config.datadogHost,
    });
  }
}
SyntheticsBaseCommand.addOption('publicId', Command.String('--publicId'));
