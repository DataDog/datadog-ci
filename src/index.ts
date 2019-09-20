import chalk from 'chalk';
import program from 'commander';

import { apiConstructor } from './helpers/dd-api';
import { PollResult, Test, TestComposite, TriggerConfig, TriggerResult } from './helpers/interfaces';
import { renderHeader, renderResult, renderTrigger, renderWait } from './helpers/renderer';
import { getSuites, handleConfig, hasTestSucceeded } from './helpers/utils';

const onError = (err: any) => {
  console.log(err);
  process.exitCode = 1;
};

process.on('uncaughtException', onError);
process.on('unhandledRejection', onError);

program
  .option('--app-key [key]', 'Application Key', process.env.DD_API_KEY)
  .option('--api-key [key]', 'API Key', process.env.DD_APP_KEY)
  .option('--api-url [url]', 'API URL', 'https://dd.datad0g.com/api/v1')
  .option('--files [glob]', 'Files to include', '{,!(node_modules)/**/}*.synthetics.json')
  .parse(process.argv);

const API_KEY = program.appKey;
const APP_KEY = program.apiKey;
const BASE_URL = program.apiUrl;
const GLOB = program.files;
const INTERVAL_CHECKING = 5000; // In ms

const main = async () => {
  if (!API_KEY || !APP_KEY) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
    process.exitCode = 1;

    return;
  }

  const { pollResults, triggerTests, getTest } = apiConstructor({
    apiKey: API_KEY,
    appKey: APP_KEY,
    baseUrl: BASE_URL,
  });

  const waitForTests = async (resultIds: string[]): Promise<PollResult[]> => {
    const finishedResults: PollResult[] = [];
    const pollingIds = [ ...resultIds ];
    let pollTimeout: NodeJS.Timeout;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearTimeout(pollTimeout);
        reject('Timeout');
      }, 60 * 60 * 1000);
      const poll = async (toPoll: string[]) => {
        const { results } = await pollResults(toPoll);
        results.forEach(result => {
          if (result.result.eventType === 'finished') {
            finishedResults.push(result);
            pollingIds.splice(pollingIds.indexOf(result.resultID), 1);
          }
        });

        if (pollingIds.length) {
          pollTimeout = setTimeout(() => {
            poll(pollingIds);
          }, INTERVAL_CHECKING);
        } else {
          clearTimeout(timeout);
          resolve(finishedResults);
        }
      };

      poll(pollingIds);
    });
  };

  const runTest = async ({ id, config }: TriggerConfig): Promise<[Test, TriggerResult[]] | []> => {
    let test: Test | undefined;
    try {
      test = await getTest(id);
    } catch (e) {
      // Just ignore it for now.
    }

    renderTrigger(test, id);
    if (test) {
      const triggerResponse = await triggerTests([id], handleConfig(test, config));
      renderWait(test);

      return [test, triggerResponse.results];
    }

    return [];
  };

  const suites = await getSuites(GLOB);
  const testPromises: Promise<[Test, TriggerResult[]] | []>[] = [];

  if (!suites.length) {
    console.log('No suites to run.');
    process.exitCode = 0;

    return;
  }

  suites.forEach(({ tests }) => {
    if (tests) {
      testPromises.push(...tests.map(runTest));
    }
  });

  try {
    const values: ([Test, TriggerResult[]] | [])[] = await Promise.all(testPromises);
    const tests: TestComposite[] = values.reduce(
      (previous: TestComposite[], [ test, results ]) => {
        if (test && results) {
          return [
            ...previous,
            {
              ...test,
              results: [],
              triggerResults: results,
            },
          ];
        }

        return previous;
      },
      []
    );

    const allResultIds: string[] = tests.reduce(
      (previous: string[], current: TestComposite) => [
        ...previous,
        ...current.triggerResults.map(r => r.result_id),
      ],
      []
    );

    const testResults = await waitForTests(allResultIds);
    testResults.forEach(result => {
      const resultId = result.resultID;
      const test = tests.find((tc: TestComposite) =>
        tc.triggerResults.find((t: TriggerResult) => t.result_id === resultId)
          ? true
          : false
      );

      if (test) {
        test.results.push(result);
      }
    });

    // Determine if all the tests have succeeded
    const hasSucceeded = tests.reduce(
      (previous: boolean, current: TestComposite) => previous && hasTestSucceeded(current),
      true
    );

    // Sort tests to show success first.
    tests.sort((t1, t2) => {
      const success1 = hasTestSucceeded(t1);
      const success2 = hasTestSucceeded(t2);

      return success1 === success2 ? 0 : success1 ? -1 : 1;
    });

    renderHeader(tests);
    tests.forEach(t => renderResult(t, BASE_URL.replace(/\/api\/v1$/, '')));

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
