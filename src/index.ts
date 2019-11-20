import chalk from 'chalk';
import program from 'commander';

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

program
  .option('--app-key [key]', 'Application Key', process.env.DD_APP_KEY)
  .option('--api-key [key]', 'API Key', process.env.DD_API_KEY)
  .option('--api-url [url]', 'API URL', 'https://dd.datad0g.com/api/v1')
  .option('--files [glob]', 'Files to include', '{,!(node_modules)/**/}*.synthetics.json')
  .option('--timeout [timeout]', 'Timeout in ms', 2 * 60 * 1000) // 2 minutes
  .parse(process.argv);

const API_KEY = program.apiKey;
const APP_KEY = program.appKey;
const BASE_URL = program.apiUrl;
const GLOB = program.files;
const TIMEOUT = program.timeout;

const main = async () => {
  const startTime = Date.now();
  if (!API_KEY || !APP_KEY) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
    process.exitCode = 1;

    return;
  }

  const api = apiConstructor({
    apiKey: API_KEY,
    appKey: APP_KEY,
    baseUrl: BASE_URL,
  });

  const suites = await getSuites(GLOB);
  const triggerTestPromises: Promise<[Test, TriggerResult[]] | []>[] = [];

  if (!suites.length) {
    console.log('No suites to run.');
    process.exitCode = 0;

    return;
  }

  suites.forEach(({ tests }) => {
    if (tests) {
      triggerTestPromises.push(...tests.map(t => runTest(api, t)));
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

    if (!allResultIds.length) {
      throw new Error('No result to poll.');
    }

    // Poll the results.
    const results = await waitForTests(api, tests, { timeout: TIMEOUT });

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
      renderResult(test, BASE_URL.replace(/\/api\/v1$/, ''));
    }

    // Determine if all the tests have succeeded
    const hasSucceeded = tests.every((test: TestComposite) => hasTestSucceeded(test));
    // Exit the program accordingly.
    if (hasSucceeded) {
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(chalk.bgRed.bold(' ERROR '), error);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}
