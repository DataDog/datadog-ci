import fs from 'fs';
import { promisify } from 'util';

import chalk from 'chalk';
import { Command } from 'clipanion';
import deepExtend from 'deep-extend';

import { apiConstructor } from './api';
import { ConfigOverride, ExecutionRule, Test, TestComposite, TriggerResult } from './interfaces';
import { renderHeader, renderResult } from './renderer';
import { getSuites, hasTestSucceeded, runTest, waitForTests } from './utils';

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

  public async execute () {
    const startTime = Date.now();

    await this.parseConfigFile();

    const suites = await getSuites(this.config!.files!, this.context.stdout.write.bind(this.context.stdout));
    const triggerTestPromises: Promise<[Test, TriggerResult[]] | []>[] = [];
    const api = this.getApiHelper();

    if (!suites.length) {
      this.context.stdout.write('No suites to run.\n');

      return 0;
    }

    suites.forEach(({ tests }) => {
      if (tests) {
        triggerTestPromises.push(
          ...tests.map(t => runTest(api, {
            config: { ...this.config!.global, ...t.config },
            id: t.id,
          }, this.context.stdout.write.bind(this.context.stdout)))
        );
      }
    });

    try {
      // Wait after all the triggers requests.
      const values: ([Test, TriggerResult[]] | [])[] = await Promise.all(triggerTestPromises);

      // Aggregate informations.
      const tests: TestComposite[] = [];
      const allResultIds: string[] = [];
      for (const [test, triggerResults] of values) {
        if (test && triggerResults) {
          tests.push({
            ...test,
            results: [],
            triggerResults,
          });
          // Get all resultIds as an array for polling.
          allResultIds.push(...triggerResults.map(r => r.result_id));
        }
      }

      // All tests have been skipped or are missing.
      if (!tests.length) {
        this.context.stdout.write('No test to run.\n');

        return 0;
      }

      if (!allResultIds.length) {
        throw new Error('No result to poll.');
      }

      // Poll the results.
      const results = await waitForTests(api, tests, { timeout: this.config.timeout });

      // Give each test its results
      tests.forEach(test => {
        test.results = results[test.public_id];
      });

      // Sort tests to show success first.
      tests.sort((t1, t2) => {
        const success1 = hasTestSucceeded(t1);
        const success2 = hasTestSucceeded(t2);

        return success1 === success2 ? 0 : success1 ? -1 : 1;
      });

      // Rendering the results.
      this.context.stdout.write(renderHeader(tests, { startTime }));
      for (const test of tests) {
        this.context.stdout.write(renderResult(test, this.config.datadogHost.replace(/\/api\/v1$/, '')));
      }

      // Determine if all the tests have succeeded
      const hasSucceeded = tests.every(
        (test: TestComposite) => hasTestSucceeded(test) || test.options.execution_rule === ExecutionRule.NON_BLOCKING
      );
      if (hasSucceeded) {
        return 0;
      } else {
        return 1;
      }
    } catch (error) {
      this.context.stdout.write(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.toString()}\n\n`);

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
