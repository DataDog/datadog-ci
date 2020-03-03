import chalk from 'chalk';

import { TriggerConfig } from './_interfaces';
import { getSuites } from './_utils';
import { SyntheticsBaseCommand } from './base';

export class ListTestsCommand extends SyntheticsBaseCommand {
  public async execute (): Promise<any> {
    const suites = await getSuites(this.config.synthetics!.files!);
    const testList = suites
      .map(suite => suite.tests)
      .reduce((tests, ts) => tests.concat(ts), [] as TriggerConfig[])
      .map(test => `  - ${test.id}`)
      .join('\n');

    console.log(`\n${chalk.bold(' Tests found: ')}\n${testList}\n`);
  }
}

ListTestsCommand.addPath('synthetics', 'list-tests');
