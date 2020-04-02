import fs from 'fs';
import { promisify } from 'util';

import chalk from 'chalk';
import { Command } from 'clipanion';
import deepExtend from 'deep-extend';

import { apiConstructor } from './api';
import { ConfigOverride, ExecutionRule } from './interfaces';
import { renderHeader, renderResult } from './renderer';
import { getSuites, hasTestSucceeded, runTests, waitForResults } from './utils';

export class RunTestCommand extends Command {
  private apiKey?: string;
  private appKey?: string;
  private config = {
    apiKey: process.env.DD_API_KEY,
    appKey: process.env.DD_APP_KEY,
    datadogHost: process.env.DD_HOST || 'https://app.datadoghq.com/api/v1',
    files: '{,!(node_modules)/**/}*.synthetics.json',
    global: { } as ConfigOverride,
    timeout: 2 * 60 * 1000,
  };
  private configPath?: string;
  private publicIds: string[] = [];

  public async execute () {
    const startTime = Date.now();

    await this.parseConfigFile();

    const api = this.getApiHelper();
    const publicIdsTriggers = this.publicIds.map(id => ({ config: { }, id }));
    const testsToTrigger = publicIdsTriggers.length ? publicIdsTriggers : await this.getTestsToTrigger();

    if (!testsToTrigger.length) {
      this.context.stdout.write('No test suites to run.\n');

      return 0;
    }

    const { tests, triggers } =
      await runTests(api, testsToTrigger, this.context.stdout.write.bind(this.context.stdout));

    // All tests have been skipped or are missing.
    if (!tests.length) {
      this.context.stdout.write('No test to run.\n');

      return 0;
    }

    if (!triggers.results) {
      throw new Error('No result to poll.');
    }

    try {
      // Poll the results.
      const results = await waitForResults(api, triggers.results, this.config.timeout);

      // Sort tests to show success first.
      tests.sort((t1, t2) => {
        const success1 = hasTestSucceeded(results[t1.public_id]);
        const success2 = hasTestSucceeded(results[t2.public_id]);

        return success1 === success2 ? 0 : success1 ? -1 : 1;
      });

      // Rendering the results.
      this.context.stdout.write(renderHeader({ startTime }));
      const baseUrl = this.config.datadogHost.replace(/\/api\/v1$/, '');
      for (const test of tests) {
        this.context.stdout.write(renderResult(test, results[test.public_id], baseUrl));
      }

      // Determine if all the tests have succeeded
      const hasSucceeded = tests.every(test =>
        hasTestSucceeded(results[test.public_id]) || test.options.ci?.executionRule === ExecutionRule.NON_BLOCKING
      );
      if (hasSucceeded) {
        return 0;
      } else {
        return 1;
      }
    } catch (error) {
      this.context.stdout.write(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.stack}\n\n`);

      return 1;
    }
  }

  private getApiHelper () {
    this.config.apiKey = this.apiKey || this.config.apiKey;
    this.config.appKey = this.appKey || this.config.appKey;

    if (!this.config.appKey || !this.config.apiKey) {
      if (!this.config.appKey) {
        this.context.stdout.write(`Missing ${chalk.red.bold('DD_APP_KEY')} in your environment.\n`);
      }
      if (!this.config.apiKey) {
        this.context.stdout.write(`Missing ${chalk.red.bold('DD_API_KEY')} in your environment.\n`);
      }
      throw new Error('API and/or Application keys are missing');
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      appKey: this.config.appKey!,
      baseUrl: this.config.datadogHost,
    });
  }

  private async getTestsToTrigger () {
    const suites = (await getSuites(this.config.files, this.context.stdout.write.bind(this.context.stdout)))
      .map(suite => suite.tests)
      .filter(suiteTests => !!suiteTests);

    const testsToTrigger = suites.reduce((acc, suiteTests) => acc.concat(suiteTests), [])
      .map(test => ({
        config: { ...this.config!.global, ...test.config },
        id: test.id,
      }));

    return testsToTrigger;
  }

  private async parseConfigFile () {
    try {
      const configPath = this.configPath || 'datadog-ci.json';
      const configFile = await promisify(fs.readFile)(configPath, 'utf-8');
      const config = JSON.parse(configFile);
      this.config = deepExtend(this.config, config);
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

RunTestCommand.addPath('synthetics', 'run-tests');
RunTestCommand.addOption('apiKey', Command.String('--apiKey'));
RunTestCommand.addOption('appKey', Command.String('--appKey'));
RunTestCommand.addOption('configPath', Command.String('--config'));
RunTestCommand.addOption('publicIds', Command.Array('-p,--public-id'));
