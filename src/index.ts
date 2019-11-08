import chalk from 'chalk';
import rc from 'rc';

import { apiConstructor } from './helpers/dd-api';
import { Test, TestComposite, TriggerResult } from './helpers/interfaces';
import { renderHeader, renderResult } from './helpers/renderer';
import { getSuites, hasTestSucceeded, runTest, waitForTests } from './helpers/utils';

const onError = (err: any) => {
  console.log(err);
  process.exitCode = 1;
};

process.on('uncaughtException', onError);
process.on('unhandledRejection', onError);

const main = async () => {
  const startTime = Date.now();
  const config = rc('synthetics', {
    apiKey: process.env.DD_API_KEY,
    apiUrl: 'https://dd.datad0g.com/api/v1',
    appKey: process.env.DD_APP_KEY,
    files: '{,!(node_modules)/**/}*.synthetics.json',
    global: { },
    timeout: 2 * 60 * 1000,
  });
  console.log(config);
  if (!config.apiKey || !config.appKey) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
    process.exitCode = 1;

    return;
  }

  const api = apiConstructor({
    apiKey: config.apiKey,
    appKey: config.appKey,
    baseUrl: config.apiUrl,
  });

  const suites = await getSuites(config.files);
  const triggerTestPromises: Promise<[Test, TriggerResult[]] | []>[] = [];

  if (!suites.length) {
    console.log('No suites to run.');
    process.exitCode = 0;

    return;
  }

  suites.forEach(({ tests }) => {
    if (tests) {
      triggerTestPromises.push(
        ...tests.map(t => runTest(api, {
          config: { ...config.global, ...t.config },
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
    for (const [test, results] of values) {
      if (test && results) {
        tests.push({
          ...test,
          results: [],
          triggerResults: results,
        });
        // Get all resultIds as an array for polling.
        allResultIds.push(...results.map(r => r.result_id));
      }
    }

    if (!allResultIds.length) {
      throw new Error('No result to poll.');
    }

    // Poll the results.
    const testResults = await waitForTests(api, allResultIds, { timeout: config.timeout });
    // Aggregate results.
    testResults.forEach(result => {
      const resultId = result.resultID;
      const test = tests.find((tc: TestComposite) =>
        tc.triggerResults.some((t: TriggerResult) => t.result_id === resultId)
      );

      if (test) {
        test.results.push(result);
      }
    });
    // Determine if all the tests have succeeded
    const hasSucceeded = tests.every((test: TestComposite) => hasTestSucceeded(test));
    // Sort tests to show success first.
    tests.sort((t1, t2) => {
      const success1 = hasTestSucceeded(t1);
      const success2 = hasTestSucceeded(t2);

      return success1 === success2 ? 0 : success1 ? -1 : 1;
    });
    // Rendering the results.
    renderHeader(tests, { startTime });
    for (const test of tests) {
      renderResult(test, config.apiUrl.replace(/\/api\/v1$/, ''));
    }
    // Exit the program accordingly.
    if (hasSucceeded) {
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.toString()}\n`);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}
