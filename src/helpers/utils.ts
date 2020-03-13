import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { URL } from 'url';
import { promisify } from 'util';

import {
  APIHelper,
  Config,
  ExecutionRule,
  Payload,
  PollResult,
  Suite,
  TemplateContext,
  Test,
  TestComposite,
  TriggerConfig,
  TriggerResult,
  WaitForTestsOptions,
} from './interfaces';
import { renderTrigger, renderWait } from './renderer';

const INTERVAL_CHECKING = 5000; // In ms
const MAX_RETRIES = 2;
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/;

export const handleQuit = (stop: () => void) => {
  // Handle unexpected exits
  process.on('exit', stop);
  // Catches ctrl+c event
  process.on('SIGINT', stop);
  // Catches "kill pid" (for example: nodemon restart)
  process.on('SIGUSR1', stop);
  process.on('SIGUSR2', stop);
  // Catches uncaught exceptions
  process.on('uncaughtException', stop);
};

export const stopIntervals = (interval: NodeJS.Timeout, timeout: NodeJS.Timeout): void => {
  clearInterval(interval);
  clearTimeout(timeout);
};

export const template = (st: string, context: any): string =>
  st.replace(/{{([A-Z_]+)}}/g, (match: string, p1: string) => context[p1] ? context[p1] : '');

export function pick<T extends object, K extends keyof T> (base: T, keys: K[]): Pick<T, K> {
  const entries = keys
    .filter(key => !!base[key])
    .map(key => ([key, base[key]]));

  return Object.fromEntries(entries);
}

export const handleConfig = (test: Test, config?: Config): Payload | undefined => {
  if (!config || !Object.keys(config).length) {
    return config;
  }

  const handledConfig = pick(config, [
    'allowInsecureCertificates',
    'basicAuth',
    'body',
    'bodyType',
    'cookies',
    'deviceIds',
    'followRedirects',
    'headers',
    'locations',
    'retry',
    'startUrl',
    'variables',
  ]);

  const objUrl = new URL(test.config.request.url);
  const subdomainMatch = objUrl.hostname.match(SUBDOMAIN_REGEX);
  const domain = subdomainMatch ? objUrl.hostname.replace(`${subdomainMatch[1]}.`, '') : objUrl.hostname;
  const context: TemplateContext = {
    ...process.env,
    DOMAIN: domain,
    HOST: objUrl.host,
    HOSTNAME: objUrl.hostname,
    ORIGIN: objUrl.origin,
    PARAMS: objUrl.search,
    PATHNAME: objUrl.pathname,
    PORT: objUrl.port,
    PROTOCOL: objUrl.protocol,
    SUBDOMAIN: subdomainMatch ? subdomainMatch[1] : undefined,
    URL: test.config.request.url,
  };

  if (config.startUrl) {
    handledConfig.startUrl = template(config.startUrl, context);
  }

  return handledConfig;
};

export const hasResultPassed = (result: PollResult): boolean => {
  if (typeof result.result.passed !== 'undefined') {
    return result.result.passed;
  }

  if (typeof result.result.errorCode !== 'undefined') {
    return false;
  }

  return true;
};

export const hasTestSucceeded = (test: TestComposite): boolean =>
  test.results.every((result: PollResult) => hasResultPassed(result));

export const getSuites = async (GLOB: string): Promise<Suite[]> => {
  console.log(`Finding files in ${path.join(process.cwd(), GLOB)}`);
  const files: string[] = await promisify((glob as any).glob)(GLOB);
  if (files.length) {
    console.log(`\nGot test files:\n${files.map(file => `  - ${file}\n`).join('')}`);
  } else {
    console.log('\nNo test files found.\n');
  }
  const contents = await Promise.all(files.map(test => fs.readFile(test, 'utf8')));

  return contents.map(content => JSON.parse(content));
};

export const waitForTests = async (
  api: APIHelper,
  tests: TestComposite[],
  opts: WaitForTestsOptions
): Promise<{ [key: string]: PollResult[] }> => {
  const finishedResults: { [key: string]: PollResult[] } = { };
  const pollingIds: string[] = [ ];
  const triggerResultsByResultID: { [key: string]: TriggerResult} = { };
  let maxErrors = MAX_RETRIES;

  Object.values(tests).forEach(test => {
    finishedResults[test.public_id] = [];
    test.triggerResults.forEach(result => {
      triggerResultsByResultID[result.result_id] = result;
      pollingIds.push(result.result_id);
    });
  });

  let pollTimeout: NodeJS.Timeout;

  return new Promise((resolve, reject) => {
    // When the polling timeout we still want to keep what we've got until now.
    const timeout = setTimeout(() => {
      clearTimeout(pollTimeout);
      // Build and inject timeout errors.
      pollingIds.forEach(resultID => {
        const triggerResult = triggerResultsByResultID[resultID];
        const pollResult: PollResult = {
          dc_id: triggerResult.location,
          result: {
            device: { id: triggerResult.device },
            error: 'Timeout',
            eventType: 'finished',
            passed: false,
            stepDetails: [],
          },
          resultID,
        };
        finishedResults[triggerResult.public_id].push(pollResult);
      });
      resolve(finishedResults);
    }, opts.timeout);

    const poll = async (toPoll: string[]) => {
      let results: PollResult[] = [];
      try {
        results = (await api.pollResults(toPoll)).results;
        maxErrors = MAX_RETRIES;
      } catch (e) {
        maxErrors -= 1;
        if (maxErrors < 0) {
          clearTimeout(timeout);
          clearTimeout(pollTimeout);
          reject(`Could not poll results: ${e.toString()}`);

          return;
        }
      }

      for (const result of results) {
        if (result.result.eventType === 'finished') {
          // Push the result.
          const publicId = triggerResultsByResultID[result.resultID].public_id;
          finishedResults[publicId].push(result);

          // Remove the resultID from the ids to poll.
          pollingIds.splice(pollingIds.indexOf(result.resultID), 1);
        }
      }

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

export const runTest = async (api: APIHelper, { id, config }: TriggerConfig): Promise<[Test, TriggerResult[]] | []> => {
  let test: Test | undefined;
  try {
    test = await api.getTest(id);
  } catch (e) {
    // Just ignore it for now.
  }

  renderTrigger(test, id, config);
  if (test && !config.skip && test.options.execution_rule !== ExecutionRule.SKIPPED) {
    const triggerResponse = await api.triggerTests([id], handleConfig(test, config));
    renderWait(test);

    return [test, triggerResponse.results];
  }

  return [];
};
