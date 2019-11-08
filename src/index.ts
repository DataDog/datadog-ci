import chalk from 'chalk';
import program from 'commander';
import fs from 'fs';
import { promisify } from 'util';

import { apiConstructor } from './helpers/dd-api';
import { ConfigFile, GlobalConfig, Test, TestComposite, TriggerResult } from './helpers/interfaces';
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
  .option('--config-file [file]', 'Path to config file')
  .parse(process.argv);

let API_KEY = program.apiKey;
let API_URL = program.apiUrl;
let APP_KEY = program.appKey;
let GLOB = program.files;
let TIMEOUT = program.timeout;
let GLOBAL_CONFIG: GlobalConfig = { };
const CONFIG_FILE = program.configFile;

const main = async () => {
  const startTime = Date.now();
  if (!API_KEY || !APP_KEY) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
    process.exitCode = 1;

    return;
  }

  let config: ConfigFile;
  try {
    const fileContent = await promisify(fs.readFile)(CONFIG_FILE, 'utf8');
    config = JSON.parse(fileContent);
  } catch (e) {
    console.log(`Error while reading/parsing ${chalk.red.bold(CONFIG_FILE)}.`, e);
    process.exitCode = 1;

    return;
  }

  if (config) {
    API_KEY = config.apiKey || API_KEY;
    APP_KEY = config.appKey || APP_KEY;
    API_URL = config.apiUrl || API_URL;
    GLOB = config.glob || GLOB;
    GLOBAL_CONFIG = config.global || GLOBAL_CONFIG;
    TIMEOUT = config.timeout || TIMEOUT;
  }

  const api = apiConstructor({
    apiKey: API_KEY,
    appKey: APP_KEY,
    baseUrl: API_URL,
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
      triggerTestPromises.push(
        ...tests.map(t => runTest(api, {
          config: { ...GLOBAL_CONFIG, ...t.config },
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
    const testResults = await waitForTests(api, allResultIds, { timeout: TIMEOUT });
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
      renderResult(test, API_URL.replace(/\/api\/v1$/, ''));
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
