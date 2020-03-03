import chalk from 'chalk';

import { Test, TestComposite, TriggerResult } from './_interfaces';
import { renderHeader, renderResult } from './_renderer';
import { getSuites, hasTestSucceeded, runTest, waitForTests } from './_utils';
import { SyntheticsBaseCommand } from './base';

export class RunTestCommand extends SyntheticsBaseCommand {
  public async execute () {
    const startTime = Date.now();
    const suites = await getSuites(this.config.synthetics!.files!);
    const triggerTestPromises: Promise<[Test, TriggerResult[]] | []>[] = [];
    const api = this.getApiHelper();

    if (!suites.length) {
      console.log('No suites to run.');

      return;
    }

    suites.forEach(({ tests }) => {
      if (tests) {
        triggerTestPromises.push(
          ...tests.map((t: any) => runTest(api, {
            config: { ...this.config.synthetics!.global, ...t.config },
            id: t.id,
          }))
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
        console.log('No test to run.');

        return;
      }

      if (!allResultIds.length) {
        throw new Error('No result to poll.');
      }

      // Poll the results.
      const results = await waitForTests(api, tests, { timeout: this.config.synthetics!.timeout! });

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
      renderHeader(tests, { startTime });
      for (const test of tests) {
        renderResult(test, this.config.datadogHost.replace(/\/api\/v1$/, ''));
      }

      // Determine if all the tests have succeeded
      const hasSucceeded = tests.every((test: TestComposite) => hasTestSucceeded(test));
      if (hasSucceeded) {
        return;
      } else {
        return;
      }
    } catch (error) {
      console.log(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.toString()}\n`);

      return;
    }
  }
}

RunTestCommand.addPath('synthetics', 'run-tests');
