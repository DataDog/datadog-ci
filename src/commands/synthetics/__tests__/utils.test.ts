jest.mock('glob');
jest.mock('fs');

import * as fs from 'fs';

import * as axios from 'axios';
import glob from 'glob';

import { apiConstructor } from '../api';
import { PollResult, Result, Test } from '../interfaces';
import {
  getSuites,
  handleConfig,
  hasResultPassed,
  hasTestSucceeded,
  runTests,
  waitForResults,
} from '../utils';

async function wait (duration: number) {
  return new Promise(resolve => setTimeout(resolve, duration));
}

describe('utils', () => {
  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    (fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path]));
    (glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES));

    test('should get suites', async () => {
      const suites = await getSuites(GLOB, process.stdout.write.bind(process.stdout));
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });

  describe('runTest', () => {
    const processWrite = process.stdout.write.bind(process.stdout);
    const fakeTest = {
      name: 'Fake Test',
      public_id: '123-456-789',
    };
    const fakeTrigger = {
      results: [],
      triggered_check_ids: [fakeTest.public_id],
    };

    beforeAll(() => {
      const axiosMock = jest.spyOn(axios.default, 'create');
      axiosMock.mockImplementation((() => (e: any) => {
        if (e.url === '/synthetics/tests/trigger/ci') {
          return { data: fakeTrigger };
        }

        if (e.url === `/synthetics/tests/${fakeTest.public_id}`) {
          return { data: fakeTest };
        }
      }) as any);
    });

    afterAll(() => {
      jest.clearAllMocks();
    });

    const api = apiConstructor({ apiKey: '123', appKey: '123', baseIntakeUrl: 'baseintake', baseUrl: 'base' });

    test('should run test', async () => {
      const output = await runTests(api, [{ id: fakeTest.public_id, config: { } }], processWrite);
      expect(output).toEqual({ tests: [fakeTest], triggers: fakeTrigger });
    });

    test('should run test with publicId from url', async () => {
      const output = await runTests(
        api, [{
          config: { },
          id: `http://localhost/synthetics/tests/details/${fakeTest.public_id}`,
        }],
        processWrite
      );
      expect(output).toEqual({ tests: [fakeTest], triggers: fakeTrigger });
    });

    test('no tests triggered throws an error', async () => {
      let hasThrown = false;
      try {
        await runTests(api, [], processWrite);
      } catch (e) {
        hasThrown = true;
      }
      expect(hasThrown).toBeTruthy();
    });

    test('skipped tests should not be run', async () => {
      let hasThrown = false;
      try {
        await runTests(api, [{ id: fakeTest.public_id, config: { skip: true } }], processWrite);
      } catch (e) {
        hasThrown = true;
      }
      expect(hasThrown).toBeTruthy();
    });
  });

  describe('handleConfig', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi';
      expect(handleConfig({ public_id: publicId } as Test, publicId)).toEqual({ public_id: publicId });
    });

    test('skip is not picked', () => {
      const publicId = 'abc-def-ghi';
      const fakeTest = {
        config: { request: { url: 'http://example.org/path' }},
        public_id: publicId,
      } as Test;
      const configOverride = { skip: true };
      expect(handleConfig(fakeTest, publicId, configOverride)).toEqual({ public_id: publicId });
    });

    test('startUrl template is rendered', () => {
      const publicId = 'abc-def-ghi';
      const fakeTest = { public_id: publicId, config: { request: { url: 'http://example.org/path' }}} as Test;
      const configOverride = { startUrl: 'https://{{DOMAIN}}/newPath?oldPath={{PATHNAME}}' };
      const expectedUrl = 'https://example.org/newPath?oldPath=/path';

      expect(handleConfig(fakeTest, publicId, configOverride)).toEqual({ public_id: publicId, startUrl: expectedUrl });
    });
  });

  describe('hasResultPassed', () => {
    test('complete result', () => {
      const pollResult = {
        dc_id: 42,
        result: {
          device: {
            id: 'laptop_large',
          },
          eventType: 'finished',
          passed: true,
          stepDetails: [],
        },
        resultID: '0123456789',
      };
      expect(hasResultPassed(pollResult)).toBeTruthy();
      pollResult.result.passed = false;
      expect(hasResultPassed(pollResult)).toBeFalsy();
    });

    test('result with error', () => {
      const pollResult = {
        dc_id: 42,
        result: {
          errorCode: 'ERRABORTED',
          eventType: 'finished',
        } as Result,
        resultID: '0123456789',
      };
      expect(hasResultPassed(pollResult)).toBeFalsy();
    });
  });

  test('hasTestSucceeded', () => {
    const passingResult = {
      device: {
        id: 'laptop_large',
      },
      eventType: 'finished',
      passed: true,
      stepDetails: [],
    };
    const passingPollResult = {
      dc_id: 42,
      result: passingResult,
      resultID: '0123456789',
    };
    const failingPollResult = {
      dc_id: 42,
      result: { ...passingResult, passed: false },
      resultID: '0123456789',
    };
    expect(hasTestSucceeded([passingPollResult, failingPollResult])).toBeFalsy();
    expect(hasTestSucceeded([passingPollResult, passingPollResult])).toBeTruthy();
  });

  describe('waitForResults', () => {
    beforeAll(() => {
      const axiosMock = jest.spyOn(axios.default, 'create');
      axiosMock.mockImplementation((() => async () => {
        await wait(100);

        return { data: { results: [passingPollResult] }};
      }) as any);
    });

    afterAll(() => {
      jest.clearAllMocks();
    });

    const api = apiConstructor({ apiKey: '123', appKey: '123', baseIntakeUrl: 'baseintake', baseUrl: 'base' });
    const passingResult = {
      device: {
        id: 'laptop_large',
      },
      eventType: 'finished',
      passed: true,
      stepDetails: [],
    };
    const passingPollResult = {
      dc_id: 42,
      result: passingResult,
      resultID: '0123456789',
    };
    const publicId = 'abc-def-ghi';
    const triggerResult = {
      device: 'laptop_large',
      location: 42,
      public_id: publicId,
      result_id: '0123456789',
    };

    test('should poll result ids', async () => {
      const expectedResults: { [key: string]: PollResult[] } = { };
      expectedResults[publicId] = [passingPollResult];
      expect(await waitForResults(api, [triggerResult], 120000)).toEqual(expectedResults);
    });

    test('results should be timeout-ed if pollingTimeout is exceeded', async () => {
      const expectedResults: { [key: string]: PollResult[] } = { };
      expectedResults[publicId] = [{
        dc_id: triggerResult.location,
        result: {
          device: { id: triggerResult.device },
          error: 'Timeout',
          eventType: 'finished',
          passed: false,
          stepDetails: [ ],
        },
        resultID: triggerResult.result_id,
      }];
      expect(await waitForResults(api, [triggerResult], 0)).toEqual(expectedResults);
    });
  });
});
