import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { promisify } from 'util';

import { Suite } from './interfaces';

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

export const getSuites = async (GLOB: string): Promise<Suite[]> => {
  console.log(`Finding files in ${path.join(process.cwd(), GLOB)}`);
  const files: string[] = await promisify((glob as any).glob)(GLOB);
  console.log(`Got test files:\n${JSON.stringify(files)}`);
  const contents = await Promise.all(files.map(test => fs.readFile(test, 'utf8')));

  return contents.map(content => JSON.parse(content));
};
