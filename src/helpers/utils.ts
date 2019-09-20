import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { promisify } from 'util';

import { Config, PollResult, Suite, Test, TestComposite } from './interfaces';

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
  if (typeof result.result.passed === 'boolean') {
    return result.result.passed;
  }

  if (typeof result.result.errorCode === 'string') {
    return false;
  }

  return true;
};

export const hasTestSucceeded = (test: TestComposite): boolean =>
  test.results.reduce((previous: boolean, current: PollResult) => previous && hasResultPassed(current), true);

export const getSuites = async (GLOB: string): Promise<Suite[]> => {
  console.log(`Finding files in ${path.join(process.cwd(), GLOB)}`);
  const files: string[] = await promisify((glob as any).glob)(GLOB);
  console.log(`Got test files:\n${JSON.stringify(files)}`);
  const contents = await Promise.all(files.map(test => fs.readFile(test, 'utf8')));

  return contents.map(content => JSON.parse(content));
};
