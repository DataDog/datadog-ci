import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { promisify } from 'util';

import { APIHelper, Config, PollResult, Suite, Test, TestComposite, TriggerConfig, TriggerResult } from './interfaces';
import { renderTrigger, renderWait } from './renderer';

const INTERVAL_CHECKING = 5000; // In ms
const POLL_TIMEOUT = 2 * 60 * 1000; // 2m

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
  st.replace(/{{([A-Z_]+)}}/g, (match: string, p1: string, offset: number) => context[p1] ? context[p1] : match);

export const handleConfig = (test: Test, config?: Config): Config | undefined => {
  if (!config || !Object.keys(config).length) {
    return config;
  }

  const handledConfig = { ...config };
  const context = {
    ...process.env,
    URL: test.config.request.url,
  };

  handledConfig.startUrl = template(config.startUrl, context);

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
  console.log(`Got test files:\n${JSON.stringify(files)}`);
  const contents = await Promise.all(files.map(test => fs.readFile(test, 'utf8')));

  return contents.map(content => JSON.parse(content));
};

export const waitForTests = async (api: APIHelper, resultIds: string[]): Promise<PollResult[]> => {
  const finishedResults: PollResult[] = [];
  const pollingIds = [ ...resultIds ];
  let pollTimeout: NodeJS.Timeout;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearTimeout(pollTimeout);
      reject('Timeout');
    }, POLL_TIMEOUT);
    const poll = async (toPoll: string[]) => {
      let results: PollResult[] = [];
      try {
        results = (await api.pollResults(toPoll)).results;
      } catch (e) {
        clearTimeout(timeout);
        clearTimeout(pollTimeout);
        reject('Could not poll results.');

        return;
      }

      for (const result of results) {
        if (result.result.eventType === 'finished') {
          finishedResults.push(result);
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

  renderTrigger(test, id);
  if (test) {
    const triggerResponse = await api.triggerTests([id], handleConfig(test, config));
    renderWait(test);

    return [test, triggerResponse.results];
  }

  return [];
};
