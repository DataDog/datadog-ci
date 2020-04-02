import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import { URL } from 'url';
import { promisify } from 'util';

import glob from 'glob';

import { formatBackendErrors } from './api';
import {
  APIHelper,
  ConfigOverride,
  ExecutionRule,
  Payload,
  PollResult,
  Suite,
  TemplateContext,
  Test,
  Trigger,
  TriggerConfig,
  TriggerResult,
} from './interfaces';
import { renderTrigger, renderWait } from './renderer';

import { pick } from '../../helpers/utils';

const INTERVAL_CHECKING = 5000; // In ms
const MAX_RETRIES = 2;
const PUBLIC_ID_REGEX = /^[\d\w]{3}-[\d\w]{3}-[\d\w]{3}$/;
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/;

const template = (st: string, context: any): string =>
  st.replace(/{{([A-Z_]+)}}/g, (match: string, p1: string) => context[p1] ? context[p1] : '');

const handleConfig = (test: Test, publicId: string, config?: ConfigOverride): Payload => {
  let handledConfig: Payload = { public_id: publicId };
  if (!config || !Object.keys(config).length) {
    return handledConfig;
  }

  handledConfig = {
    ...handledConfig,
    ...pick(config, [
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
      'variables',
  ])};

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

export const hasTestSucceeded = (results: PollResult[]): boolean =>
  results.every((result: PollResult) => hasResultPassed(result));

export const getSuites = async (GLOB: string, write: Writable['write']): Promise<Suite[]> => {
  write(`Finding files in ${path.join(process.cwd(), GLOB)}\n`);
  const files: string[] = await promisify(glob)(GLOB);
  if (files.length) {
    write(`\nGot test files:\n${files.map(file => `  - ${file}\n`).join('')}\n`);
  } else {
    write('\nNo test files found.\n\n');
  }

  return Promise.all(files.map(async test => {
    try {
      const content = await promisify(fs.readFile)(test, 'utf8');

      return JSON.parse(content);
    } catch (e) {
      throw new Error(`Unable to read and parse the test file ${test}`);
    }
  }));
};

export const waitForResults = async (
  api: APIHelper,
  triggerResults: TriggerResult[],
  pollingTimeout: number
): Promise<{ [key: string]: PollResult[] }> => {
  const finishedResults: { [key: string]: PollResult[] } = { };
  const pollingIds = triggerResults.map(triggerResult => triggerResult.result_id);
  const triggerResultsByResultID =
    Object.fromEntries(triggerResults.map(triggerResult => [triggerResult.result_id, triggerResult]));
  triggerResults.forEach(triggerResult => {
    if (!Object.keys(finishedResults).includes(triggerResult.public_id)) {
      finishedResults[triggerResult.public_id] = [];
    }
  });
  let maxErrors = MAX_RETRIES;

  let pollTimeout: NodeJS.Timeout;

  return new Promise((resolve, reject) => {
    // When the polling timeout we still want to keep what we've got until now.
    const timeout = setTimeout(() => {
      clearTimeout(pollTimeout);
      // Build and inject timeout errors.
      triggerResults.forEach(triggerResult => {
        const pollResult: PollResult = {
          dc_id: triggerResult.location,
          result: {
            device: { id: triggerResult.device },
            error: 'Timeout',
            eventType: 'finished',
            passed: false,
            stepDetails: [],
          },
          resultID: triggerResult.result_id,
        };
        finishedResults[triggerResult.public_id].push(pollResult);
      });
      resolve(finishedResults);
    }, pollingTimeout);

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

export const runTests = async (api: APIHelper, triggerConfigs: TriggerConfig[], write: Writable['write']):
  Promise<{ tests: Test[]; triggers: Trigger }> => {
  const testsToTrigger: Payload[] = [];

  const tests = await Promise.all(triggerConfigs.map(async ({ config, id }) => {
    let test: Test | undefined;
    id = PUBLIC_ID_REGEX.test(id) ? id : id.substr(id.lastIndexOf('/') + 1);
    try {
      test = await api.getTest(id);
    } catch (e) {
      const errorMessage = formatBackendErrors(e);
      write(`[${id}] Test not found: ${errorMessage}\n`);
    }

    if (!test || config.skip || test.options?.ci?.executionRule === ExecutionRule.SKIPPED) {
      return;
    }

    write(renderTrigger(test, id, config));
    const overloadedConfig = handleConfig(test, id, config);
    write(renderWait(test));
    testsToTrigger.push(overloadedConfig);

    return test;
  }));

  if (!testsToTrigger.length) {
    throw new Error('No tests to trigger');
  }

  try {
    return {
      tests: tests.filter(definedTypeGuard),
      triggers: await api.triggerTests(testsToTrigger),
    };
  } catch (e) {
    const errorMessage = formatBackendErrors(e);
    const testIds = testsToTrigger.map(t => t.public_id).join(',');
    // Rewrite error message
    throw new Error(`[${testIds}] Failed to trigger tests: ${errorMessage}\n`);
  }
};

function definedTypeGuard<T> (o: T | undefined): o is T {
  return !!o;
}
