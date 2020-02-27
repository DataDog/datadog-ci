import chalk from 'chalk';

import { apiConstructor } from './api';
import { APIHelper, Test, TestComposite, TriggerResult } from './interfaces';
import { renderHeader, renderResult } from './renderer';
import { getSuites, hasTestSucceeded, runTest, waitForTests } from './utils';

export async function run (config: { [key: string]: any }) {
  const api = apiConstructor({
    apiKey: config.apiKey,
    appKey: config.appKey,
    baseUrl: config.apiUrl,
  });

  const subCommand = config._[1];

  if (subCommand === 'run-test') {
    return runTests(api, config);
  } else {
    displayUsage();

    return 0;
  }
}

function displayUsage () {
  const usage = `No subcommand has been specified. Available subcommands:
  - run-tests`;

  console.log(usage);
}

async function runTests (api: APIHelper, config: { [key: string]: any }) {
  const startTime = Date.now();
  const suites = await getSuites(config.files);
  const triggerTestPromises: Promise<[Test, TriggerResult[]] | []>[] = [];

  if (!suites.length) {
    console.log('No suites to run.');

    return 0;
  }

  suites.forEach(({ tests }) => {
    if (tests) {
      triggerTestPromises.push(
        ...tests.map((t: any) => runTest(api, {
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

      return 0;
    }

    if (!allResultIds.length) {
      throw new Error('No result to poll.');
    }

    // Poll the results.
    const results = await waitForTests(api, tests, { timeout: config.timeout });

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
      renderResult(test, config.apiUrl.replace(/\/api\/v1$/, ''));
    }

    // Determine if all the tests have succeeded
    const hasSucceeded = tests.every((test: TestComposite) => hasTestSucceeded(test));
    if (hasSucceeded) {
      return 0;
    } else {
      return 1;
    }
  } catch (error) {
    console.log(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.toString()}\n`);

    return 1;
  }
}
