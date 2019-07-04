import chalk from 'chalk';
import program from 'commander';

import { apiConstructor } from './helpers/dd-api';
import { Result, ResultContainer, Test } from './helpers/interfaces';
import { renderResult, renderSteps, renderTrigger, renderWait } from './helpers/renderer';
import { getSuites, handleQuit, stopIntervals } from './helpers/utils';

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
  .option('--files [glob]', 'Files to include', './**/*.synthetics.json')
  .parse(process.argv);

const API_KEY = program.appKey;
const APP_KEY = program.apiKey;
const BASE_URL = program.apiUrl;
const GLOB = program.files;

if (!API_KEY || !APP_KEY) {
  console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
  process.exitCode = 1;
}

const { getLatestResult, triggerTests, getTest } = apiConstructor({
  apiKey: API_KEY!,
  appKey: APP_KEY!,
  baseUrl: BASE_URL,
});

const pollNextResult = (id: string) => new Promise<ResultContainer>(async (resolve, reject) => {
  const latestResult = await getLatestResult(id);
  const timeout = setTimeout(() => {
    reject('Timeout');
  }, 60 * 60 * 1000); // Timeout after 1 hour.

  const interval = setInterval(async () => {
    const result = await getLatestResult(id);
    if (!result) {
      return;
    }

    if (
      !latestResult ||
      result.result_id !== latestResult.result_id
    ) {
      stopIntervals(interval, timeout);
      resolve(result);
    }
  }, 5000); // Make a request every 5 seconds.

  // Safety exit.
  handleQuit(() => stopIntervals(interval, timeout));
});

const runTest = async ({ id }: { id: string }): Promise<[Test, Result]> => {
  const test: Test = await getTest(id);
  renderTrigger(test);
  await triggerTests([id]);
  renderWait(test);
  const { result } = await pollNextResult(id);
  renderSteps(test, result);

  return [test, result];
};

const main = async () => {
  const suites = await getSuites(GLOB);
  const testPromises: Promise<[Test, Result]>[] = [];

  if (!suites.length) {
    console.log('No suites to run.');
    process.exitCode = 0;
  }

  suites.forEach(({ tests }) => {
    if (tests) {
      testPromises.push(...tests.map(runTest));
    }
  });

  try {
    const results = await Promise.all(testPromises);
    let hasSucceed = true;
    results.forEach(([test, result]) => {
      renderResult(test, result);
      hasSucceed = hasSucceed && result.passed;
    });
    if (hasSucceed) {
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
